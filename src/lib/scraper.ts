export async function scrapeUrl(url: string): Promise<{ title: string; content: string; source: string }> {
  let source = 'other';
  const lowercaseUrl = url.toLowerCase();
  
  if (lowercaseUrl.includes('twitter.com') || lowercaseUrl.includes('x.com')) {
    source = 'twitter';
  } else if (lowercaseUrl.includes('reddit.com')) {
    source = 'reddit';
  } else if (lowercaseUrl.includes('linkedin.com')) {
    source = 'linkedin';
  } else if (lowercaseUrl.includes('facebook.com')) {
    source = 'facebook';
  } else if (lowercaseUrl.includes('medium.com')) {
    source = 'medium';
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      // Short timeout
      signal: AbortSignal.timeout(6000)
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch page: ${res.statusText}`);
    }

    const html = await res.text();

    // Extract Title
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    let title = titleMatch ? titleMatch[1].trim() : '';
    
    title = title
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    // Clean HTML and extract text
    let cleanHtml = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')
      .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');

    // Extract text inside paragraph tags
    const paragraphs: string[] = [];
    const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let match;
    while ((match = pRegex.exec(cleanHtml)) !== null) {
      const pText = match[1]
        .replace(/<[^>]+>/g, '') // Strip inner HTML tags
        .replace(/\s+/g, ' ')     // Collapse whitespace
        .trim();
      if (pText.length > 20) {
        paragraphs.push(pText);
      }
    }

    let content = paragraphs.slice(0, 10).join('\n\n');

    // Fall back to body stripping if paragraphs are empty
    if (content.length < 100) {
      const bodyMatch = cleanHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      const bodyText = bodyMatch ? bodyMatch[1] : cleanHtml;
      content = bodyText
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      if (content.length > 1500) {
        content = content.substring(0, 1500) + '...';
      }
    }

    if (!title || title.toLowerCase() === 'twitter' || title.toLowerCase() === 'x') {
      title = `${source.charAt(0).toUpperCase() + source.slice(1)} Post`;
    }
    if (content.length < 50) {
      content = `Shared post from ${source}. Analyzing metadata and path slug for topic context: ${url}`;
    }

    return { title, content, source };
  } catch (error) {
    console.error(`Scraping error for ${url}:`, error);
    return {
      title: `${source.charAt(0).toUpperCase() + source.slice(1)} Shared Post`,
      content: `Social media post analysis request. Target URL: ${url}. Local AI will evaluate perspectives based on the web link context and title info.`,
      source
    };
  }
}
