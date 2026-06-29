import { NextResponse } from 'next/server';
import { scrapeUrl } from '@/lib/scraper';
import { createClient } from '@supabase/supabase-js';

// Load env variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const ollamaHost = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { link, userId } = body;

    if (!link) {
      return NextResponse.json({ error: 'Link is required' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json({ error: 'User authentication session required' }, { status: 401 });
    }

    // Get Auth token from headers for Supabase RLS
    const authHeader = req.headers.get('Authorization');
    
    // Initialize Supabase client if configured
    let supabaseClient: any = null;
    if (supabaseUrl && supabaseAnonKey) {
      supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: {
          headers: authHeader ? { Authorization: authHeader } : {},
        },
      });
    }

    // 1. Check if input is a URL or a general topic/statement
    const isUrl = link.startsWith('http://') || link.startsWith('https://') || link.startsWith('www.');
    let title = '';
    let content = '';
    let source = 'manual';

    if (isUrl) {
      // Normalize URLs starting with www.
      const targetUrl = link.startsWith('www.') ? `https://${link}` : link;
      const scrapeRes = await scrapeUrl(targetUrl);
      title = scrapeRes.title;
      content = scrapeRes.content;
      source = scrapeRes.source;
    } else {
      title = link;
      content = `The user requested a stance and perspective analysis on the following topic/statement: "${link}".`;
      source = 'manual';
    }

    // 2. Query local Ollama — ZERO pre-flight checks, stream direct
    const systemPrompt = `Adopt the persona of an objective, high-caliber news agency analyst. Your task is to perform an objective, news-specific stance analysis on current events. Use precise, journalistic terminology. Avoid sensationalism, bias, or subjective filler.

Return ONLY valid JSON matching the format schema. No markdown, no pre-text, no post-text.

CRITICAL INSTRUCTIONS:
1. "why": Write a direct, fact-driven summary of the core news hook, trigger, or current developments driving this debate. Avoid filler introductions. Must be concise (exactly 1-2 sentences).
2. "overview": Write exactly ONE high-level overview bullet point summarizing the news context. Do NOT list group stances here.
3. "perspectives": Identify exactly 2 distinct stakeholder groups in the news (e.g., official agencies, affected public, advocacy groups, industry representatives). For each group, state their "name" and their core position/argument ("stance" - exactly 1 concise sentence), followed by exactly 1 key point in the "points" array.
4. Journalistic details: Every "detail" field in both overview and perspectives MUST explain specific claims or structural arguments, and be exactly 1 descriptive, highly informative sentence.

Schema Format:
{
  "title": "Topic Name",
  "why": "Explanation of why this event or debate is happening. Exactly 1-2 sentences.",
  "overview": [
    {
      "bullet": "Brief topic summary",
      "detail": "General context explanation. Exactly 1 sentence.",
      "impact": "Overall significance"
    }
  ],
  "perspectives": [
    {
      "name": "Group Name",
      "stance": "Summary of this group's overall point of view. Exactly 1 sentence.",
      "points": [
        {
          "bullet": "Stance bullet label",
          "detail": "Detailed explanation of their reasoning. Exactly 1 sentence.",
          "impact": "Consequence or effect"
        }
      ]
    }
  ]
}`;

    const userPrompt = `Perform a journalistic stance analysis on this news topic: "${title}"\nContext: ${content.substring(0, 800)}`;

    // Fire Ollama request immediately — no health check overhead
    try {
      const ollamaResponse = await fetch(`${ollamaHost}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.OLLAMA_MODEL || 'llama3.2:1b',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          stream: true,
          format: 'json',
          options: {
            temperature: 0.4,
            num_predict: 700,
            num_ctx: 1536       // Smaller context window = faster KV cache
          }
        }),
      });

      if (!ollamaResponse.ok) {
        throw new Error(`Ollama ${ollamaResponse.status}: ${ollamaResponse.statusText}`);
      }

      // === ZERO-COPY SSE STREAM ===
      // Parse Ollama NDJSON, extract tokens, forward as SSE events
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const reader = ollamaResponse.body?.getReader();
          if (!reader) { controller.close(); return; }

          const decoder = new TextDecoder();
          let fullText = '';

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const chunk = decoder.decode(value, { stream: true });
              for (const line of chunk.split('\n')) {
                if (!line.trim()) continue;
                try {
                  const parsed = JSON.parse(line);
                  const token = parsed.message?.content || '';
                  if (token) {
                    fullText += token;
                    // SSE format: each token as a data event
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token, done: false })}\n\n`));
                  }
                  // Forward Ollama's done signal
                  if (parsed.done) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: '', done: true, full: fullText })}\n\n`));
                  }
                } catch { /* skip partial JSON lines */ }
              }
            }

            // Save to Supabase if configured
            if (supabaseClient && fullText) {
              try {
                await supabaseClient.from('analyses').insert({
                  user_id: userId, link, source,
                  content: content.substring(0, 1000),
                  summary: fullText, perspectives: []
                });
              } catch (e) {
                console.error('DB save error:', e);
              }
            }
          } catch (err) {
            controller.error(err);
          } finally {
            controller.close();
          }
        }
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',  // Disable nginx buffering if proxied
        }
      });

    } catch (ollamaErr: any) {
      console.log(`Ollama unavailable (${ollamaErr.message}), using local fallback engine.`);
      // Fall through to local fallback below
    }

    // ---- Local rules-based fallback (Ollama not available) ----
    console.log('Using local rules-based NLP fallback engine.');
    const topicLower = title.toLowerCase();
    let responseData: any;

    if (topicLower.includes('iran') || topicLower.includes('israel') || topicLower.includes('war') || topicLower.includes('middle east')) {
      responseData = {
        title: "Iran-Israel Conflict",
        why: "Escalating regional tensions, direct military strikes, and the long-standing shadow war over influence and nuclear enrichment capabilities in the Middle East.",
        overview: [
          { bullet: "Decades-long rivalry turned direct confrontation", detail: "Proxy conflicts in Lebanon, Syria, and Gaza have recently escalated to direct military exchanges, including drone and missile strikes. This marked a historical shift from shadow warfare to direct, open confrontation between the two states.", impact: "Risk of wider regional war" },
          { bullet: "Nuclear program is the core flashpoint", detail: "Israel views Iran's nuclear enrichment capabilities as a direct existential danger that must be stopped at all costs. Iran asserts its program is strictly peaceful and represents a sovereign right to advanced technology.", impact: "Global non-proliferation at stake" },
          { bullet: "Millions of civilians displaced and affected", detail: "Heavy airstrikes, blockades, and economic sanctions continue to disrupt ordinary citizens' lives across the region. The civilian toll is marked by physical destruction, deep psychological trauma, and long-term economic instability." }
        ],
        perspectives: [
          {
            name: "Iran's Stance",
            stance: "Iran frames its foreign policy as defending regional sovereignty against Western imperialism and Israeli occupation.",
            points: [
              { bullet: "Resistance to Western aggression", detail: "Iranian leadership portrays its military actions as a necessary defense of the Islamic Republic and its regional allies. They argue that they are countering decades of US and Israeli efforts to destabilize the region.", impact: "Rallies domestic and regional support" },
              { bullet: "Nuclear development as a sovereign right", detail: "Iran maintains that its nuclear development is intended solely for domestic power generation, science, and medical research. They call international restrictions hypocritical given the undeclared nuclear arsenals of their adversaries." }
            ]
          },
          {
            name: "Israel's Stance",
            stance: "Israel views Iranian influence and its nuclear program as the absolute greatest threat to the survival of the Jewish state.",
            points: [
              { bullet: "Existential threat of a nuclear Iran", detail: "Israeli leaders state that a nuclear-armed Iran would directly threaten the country with destruction. They maintain that all options, including preemptive military strikes, remain on the table to prevent enrichment.", impact: "Drives preemptive military doctrine" },
              { bullet: "Preemptive self-defense actions", detail: "Israel justifies its military operations in neighboring countries like Syria and Lebanon as proactive defense. They argue these actions are necessary to disrupt the supply lines of hostile proxy groups before they can strike." }
            ]
          },
          {
            name: "Affected Civilians",
            stance: "Civilians across the region feel caught in a conflict they did not choose, bearing the heavy human and economic costs.",
            points: [
              { bullet: "Heaviest casualties and disruption", detail: "Ordinary people in Israel, Lebanon, and Gaza suffer the primary impacts of missiles and shelling. Families face constant displacement, loss of livelihoods, and the destruction of basic infrastructure.", impact: "Humanitarian crisis across the region" },
              { bullet: "Sanctions crush everyday life in Iran", detail: "International sanctions aimed at the Iranian government have severely depreciated the local currency. This has directly driven up the cost of basic food, critical medical supplies, and general living expenses." }
            ]
          },
          {
            name: "Regional Neighbors",
            stance: "Neighboring Arab states seek to preserve their own security and economic growth while balancing ties between the primary combatants.",
            points: [
              { bullet: "Sovereignty caught in proxy wars", detail: "Countries like Lebanon, Iraq, and Syria frequently see their territory utilized as launching pads or targets. This severely undermines their national sovereignty and delays their own political recovery.", impact: "Sovereign nations destabilized" },
              { bullet: "Pragmatic diplomatic balancing", detail: "Gulf nations are actively pursuing diplomatic normalization and economic treaties with Israel. Simultaneously, they are keeping communication channels open with Iran to prevent a major regional escalation." }
            ]
          },
          {
            name: "International Powers",
            stance: "The international community is divided between preventing a global economic shock and maintaining strategic alliances.",
            points: [
              { bullet: "Fear of global economic disruption", detail: "Major powers are highly concerned that a wider war could block shipping lanes and cause oil prices to spike. This scenario would severely disrupt global trade and potentially trigger a worldwide recession.", impact: "Global recession risk" },
              { bullet: "Stalled diplomatic frameworks", detail: "Diplomats express frustration that past frameworks, such as the JCPOA nuclear deal, are now obsolete. Reaching any new consensus is extremely difficult due to deep-seated distrust and shifting global alliances." }
            ]
          }
        ]
      };
    } else if (topicLower.includes('ai') || topicLower.includes('artificial') || topicLower.includes('job') || topicLower.includes('creativ')) {
      responseData = {
        title: "AI vs Creative Jobs",
        why: "The rapid rise of generative AI tools (like Midjourney and GPT-4) that produce professional content in seconds, threatening human creative roles and budgets.",
        overview: [
          { bullet: "Professional content generated in seconds", detail: "Generative AI tools like Midjourney, GPT-4, and Copilot can now produce graphics, text, and source code at a fraction of human turnaround time. This capability has disrupted traditional production cycles and forced industries to adapt almost overnight.", impact: "Substantial impact on current creative workflows" },
          { bullet: "Core debate: replacement or co-pilot", detail: "Some view AI as a powerful assistant that automates mundane tasks and frees humans for higher-level creativity. Others argue it directly displaces human workers by offering cheap, automated alternatives that clients prefer." },
          { bullet: "Copyright laws are lagging behind", detail: "Courts are currently struggling to address whether AI models can legally train on copyrighted artwork without direct permission. The legal definition of authorship and derivative works is being re-evaluated globally." }
        ],
        perspectives: [
          {
            name: "Creative Workers",
            stance: "Creatives fear that automated generation will severely devalue human artistic labor and replace entry-level roles.",
            points: [
              { bullet: "Devaluation of artistic labor", detail: "Freelancers and full-time artists report a sharp decline in client demand and project budgets. They argue that commercial clients are choosing fast, low-cost AI assets over custom human craftsmanship.", impact: "Freelance rates already dropping" },
              { bullet: "Systemic copyright infringement", detail: "Artists contend that their portfolios were scraped without consent or compensation to build profitable commercial AI models. They view this practice as a form of intellectual property theft that directly competes against them." }
            ]
          },
          {
            name: "Tech Companies",
            stance: "Technology developers argue AI tools democratize creativity and act as a productivity booster for skilled professionals.",
            points: [
              { bullet: "AI as a collaborative co-pilot", detail: "Developers argue that AI behaves like past technological leaps, such as digital cameras or drawing tablets, which initially caused concern but eventually expanded the industry. They believe it makes creative output faster and more accessible.", impact: "Billions invested in AI tools" },
              { bullet: "Innovation demands open training", detail: "Tech firms claim that restrictive copyright guidelines would halt progress and push development to regions with fewer regulations. They argue that training AI on public data is equivalent to human learning from observation." }
            ]
          },
          {
            name: "Businesses & Clients",
            stance: "Businesses prioritize operational efficiency and cost savings but remain concerned about brand consistency and legal compliance.",
            points: [
              { bullet: "Substantial cost reductions", detail: "Companies can now generate marketing copy, placeholder illustrations, and basic code internally without hiring external agencies. This shift allows them to allocate budgets elsewhere and scale content production rapidly.", impact: "Budgets shifting away from creative teams" },
              { bullet: "Brand dilution and legal risks", detail: "Corporate legal teams caution that AI-generated assets cannot currently be copyrighted, leaving their brands unprotected. Additionally, the tendency of AI models to hallucinate or copy existing designs creates potential legal liabilities." }
            ]
          },
          {
            name: "Consumers & Society",
            stance: "The public enjoys free creative tools but worries about the massive rise of digital misinformation and synthetic media.",
            points: [
              { bullet: "Democratization of production", detail: "Anyone can now express their ideas in high-fidelity media, regardless of formal art training or financial resources. This has led to a burst of amateur creativity and personalized media generation.", impact: "Misinformation risk increases" },
              { bullet: "Loss of trust in digital media", detail: "The proliferation of deepfakes and AI-written articles makes it increasingly difficult to verify authentic information. Society faces a growing threat of automated propaganda and synthetic news campaigns." }
            ]
          }
        ]
      };
    } else if (topicLower.includes('bitcoin') || topicLower.includes('crypto') || topicLower.includes('regulat') || topicLower.includes('finance')) {
      responseData = {
        title: "Crypto Regulation Battle",
        why: "Recent high-profile collapses of major crypto exchanges and fraud schemes that caused billions in retail investor losses and highlighted risks of illicit finance.",
        overview: [
          { bullet: "Accelerating global regulatory race", detail: "Recent high-profile exchange collapses and fraudulent schemes have pushed international regulators to draft strict compliance laws. This has introduced significant volatility as the market adjusts to the prospect of formal oversight.", impact: "Markets volatile as rules take shape" },
          { bullet: "Decentralization vs systemic control", detail: "The original ethos of cryptocurrency is built on trustless, peer-to-peer networks that operate independently of central banks. Modern regulation challenges this model by attempting to enforce centralized reporting requirements." },
          { bullet: "Retail investors suffer major losses", detail: "Unregulated markets have allowed speculative bubbles to form, resulting in massive financial losses for everyday retail investors when platforms collapse. These incidents have intensified political demands for consumer protection rules." }
        ],
        perspectives: [
          {
            name: "Crypto Believers",
            stance: "Enthusiasts argue that aggressive regulation stifles innovation and defeats the purpose of decentralized financial systems.",
            points: [
              { bullet: "Infringement on financial privacy", detail: "Proponents argue that decentralized finance (DeFi) offers users complete ownership of their assets without relying on intermediaries. They believe that forcing identification checks on smart contracts violates basic privacy principles.", impact: "Community pushback on compliance" },
              { bullet: "Financial inclusion for the unbanked", detail: "Believers highlight that crypto provides millions of people in developing nations with access to global financial services. They state that heavy compliance fees will lock out the very populations that benefit most." }
            ]
          },
          {
            name: "Regulators",
            stance: "Government agencies assert that consumer protection, market integrity, and preventing illicit finance require strict legal boundaries.",
            points: [
              { bullet: "Mandatory investor safeguards", detail: "Regulators argue that digital asset exchanges must be held to the same standards as traditional stock markets to prevent fraud. They believe that clear audit requirements are essential to protect the public's savings.", impact: "New licensing and disclosure rules" },
              { bullet: "Combating global illicit finance", detail: "Authorities point out that the pseudonymity of transactions makes crypto an attractive tool for money laundering, tax evasion, and cyber extortion. They argue that tracking transaction flows is a matter of national security." }
            ]
          },
          {
            name: "Retail Investors",
            stance: "Individual investors seek a secure trading environment that prevents fraud without eliminating market accessibility.",
            points: [
              { bullet: "Vulnerability to exchange failures", detail: "Many retail traders have lost their entire savings due to bankruptcies of unregulated yield platforms and exchanges. They argue that the lack of deposit insurance makes the current ecosystem highly dangerous.", impact: "Trust in crypto deeply damaged" },
              { bullet: "Fear of regulatory overreach", detail: "Investors worry that overly strict local laws will force crypto businesses to move offshore, leaving domestic users with fewer options. They support basic fraud prevention but reject rules that ban retail participation." }
            ]
          },
          {
            name: "Traditional Finance",
            stance: "Established banks view cryptocurrency as a competitive threat that must be regulated equally while they selectively adopt blockchain tech.",
            points: [
              { bullet: "Demanding a level playing field", detail: "Banks argue that crypto firms have operated with an unfair advantage by bypassing costly banking regulations and capital requirements. They lobby governments to enforce identical rules on all financial intermediaries.", impact: "Banks lobbying for strict crypto rules" },
              { bullet: "Selectively adopting blockchain", detail: "Major banks exploring tokenization and settlement while opposing decentralized competitors." }
            ]
          }
        ]
      };
    } else if (topicLower.includes('work') || topicLower.includes('office') || topicLower.includes('remote')) {
      responseData = {
        title: "Remote vs Office Work",
        why: "A fundamental shift in employee expectations for flexibility and work-life balance following the pandemic, contrasting with executives' demands for in-person collaboration.",
        overview: [
          { bullet: "Hybrid model as the new baseline", detail: "The pandemic proved that knowledge workers can remain productive outside of a traditional corporate office. This realization has forced companies to adopt hybrid arrangements as standard policy to retain top talent.", impact: "Hybrid models becoming the default" },
          { bullet: "Productivity metrics are highly debated", detail: "Executives often cite a decline in spontaneous collaboration and mentoring when teams are fully remote. Meanwhile, employees present studies showing higher output and longer working hours when commuting is eliminated." },
          { bullet: "Real estate and urban economic shifts", detail: "The permanent drop in office occupancy rates has caused a severe decline in commercial property values. This shift has negatively impacted downtown retail businesses and reduced local tax revenues in major cities." }
        ],
        perspectives: [
          {
            name: "Employees",
            stance: "Workers prioritize flexibility, improved work-life balance, and cost savings associated with remote work.",
            points: [
              { bullet: "Significant lifestyle improvements", detail: "Employees value the elimination of long daily commutes, which directly reduces stress and increases personal time. They report having more flexibility to care for family members and manage household tasks.", impact: "Willing to take pay cuts for remote" },
              { bullet: "Financial relief from commuting costs", detail: "Working from home saves significant money on transit, fuel, parking, and professional wardrobe items. Many workers view forced return-to-office mandates as an indirect pay cut." }
            ]
          },
          {
            name: "Corporate Executives",
            stance: "Business leaders argue that long-term innovation, company culture, and employee training require physical presence.",
            points: [
              { bullet: "Preserving collaborative culture", detail: "Executives believe that complex problem-solving and creative brainstorming are best done face-to-face in a shared space. They argue that remote work leads to siloed teams and weakens corporate identity.", impact: "Real estate investments at stake" },
              { bullet: "Facilitating onboarding and mentorship", detail: "Leaders point out that junior employees miss out on passive learning and informal mentoring when working in isolation. They assert that in-person interaction is crucial for career development and training." }
            ]
          },
          {
            name: "Middle Managers",
            stance: "Managers find themselves caught between executive mandates and employee resistance while adjusting their coordination methods.",
            points: [
              { bullet: "Struggling with remote team metrics", detail: "Traditional managers who rely on visual supervision find it difficult to track output and engagement online. They often struggle to verify productivity without introducing intrusive micromanagement tools.", impact: "Management layer being compressed" },
              { bullet: "Enforcing unpopular corporate policies", detail: "Managers are tasked with executing return-to-office policies that they may personally oppose or struggle to justify. This dynamic creates friction with their teams and increases turnover." }
            ]
          },
          {
            name: "Cities & Local Economies",
            stance: "Urban centers face budget shortfalls and declining retail activity, while suburban residential areas experience growth.",
            points: [
              { bullet: "Economic crises in commercial districts", detail: "Downtown restaurants, convenience stores, and public transit systems are suffering from the lack of daily commuter traffic. This decline has forced businesses to close and reduced city tax bases.", impact: "Urban tax bases shrinking" },
              { bullet: "Suburban and regional revitalization", detail: "As employees relocate to cheaper, more spacious neighborhoods, local suburban economies are seeing increased consumer spending. This trend has decentralized economic activity away from dense city centers." }
            ]
          }
        ]
      };
    } else {
      responseData = {
        title: `Analysis: ${title}`,
        why: "Competing incentives, technological changes, and shifting societal values that create policy disputes between different interest groups.",
        overview: [
          { bullet: "Division of public and institutional opinion", detail: "Almost all modern political, scientific, or social debates reveal deeply divided viewpoints with valid arguments on multiple sides. A single perspective rarely captures the full context or the historical background of the topic.", impact: "Public opinion divided" },
          { bullet: "Nuance is overshadowed by simplified media", detail: "Modern media channels and algorithms tend to simplify complex issues into binary conflicts for user engagement. Understanding the actual policy trade-offs requires analyzing secondary details and quiet concessions." },
          { bullet: "Long-term policy choices determine outcomes", detail: "Decisions made by regulatory bodies and community leaders today will set the trajectory for the future. These choices often involve balancing immediate convenience against long-term societal sustainability." }
        ],
        perspectives: [
          {
            name: "Supporters",
            stance: "Proponents highlight the potential for positive innovation, economic progress, and social improvement.",
            points: [
              { bullet: "Potential for progress and efficiency", detail: "Supporters argue that adopting the proposed changes will streamline legacy systems and drive technological growth. They focus on the positive outcomes and the direct benefits of moving past the status quo.", impact: "Could drive significant positive change" },
              { bullet: "Precedent of successful implementation", detail: "Advocates point to pilot studies and case studies from other regions or industries where similar models succeeded. They claim these examples demonstrate that the risks can be managed effectively." }
            ]
          },
          {
            name: "Critics",
            stance: "Opponents urge caution, highlighting systemic risks, unintended negative side-effects, and ethical concerns.",
            points: [
              { bullet: "Risk of unintended consequences", detail: "Critics warn that rapid adoption without guardrails could destabilize existing systems and harm vulnerable groups. They argue that the hidden costs and ethical concerns outweigh the promised benefits.", impact: "Could cause damage without safeguards" },
              { bullet: "Demand for comprehensive testing", detail: "Opponents call for independent impact assessments and pilot projects before any wide-scale deployment is authorized. They advise that proceeding slowly is the safest path." }
            ]
          },
          {
            name: "Affected Communities",
            stance: "Ordinary citizens want practical, real-world solutions that address their immediate needs rather than abstract theories.",
            points: [
              { bullet: "Lack of representation in decisions", detail: "Community members complain that the people most impacted by policy decisions are rarely given a voice in the planning stages. They argue that top-down solutions fail to address local realities.", impact: "Outcomes imposed without consent" },
              { bullet: "Focus on basic quality of life", detail: "Civilians prioritize immediate, tangible concerns like safety, employment, and access to services. They reject ideological posturing from both sides in favor of functional compromises." }
            ]
          },
          {
            name: "Neutral Analysts",
            stance: "Independent researchers seek an evidence-based compromise that balances the most valid points of all stakeholders.",
            points: [
              { bullet: "Evidence-based compromise paths", detail: "Analysts assert that the most sustainable solutions lie in a hybrid approach that addresses critic concerns while allowing innovation. They advocate for independent data collection to guide policy decisions.", impact: "Centrist approaches most sustainable" }
            ]
          }
        ]
      };
    }

    return NextResponse.json(responseData);

  } catch (err: any) {
    console.error('Analyze Route Error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error occurred' },
      { status: 500 }
    );
  }
}
