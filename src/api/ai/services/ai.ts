import OpenAI from 'openai';
import axios from 'axios';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Hàm làm sạch JSON string
const cleanJsonString = (text: string) => {
    if (!text) return "{}";
    return text.replace(/^```json\s*/, "")
        .replace(/^```\s*/, "")
        .replace(/\s*```$/, "")
        .trim();
};

// Hàm lấy nội dung từ URL
const getContentFromUrl = async (url: string) => {
    try {
        // Giả lập User-Agent
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5'
        };

        const response = await axios.get(url, { headers, timeout: 5000 });
        const html = response.data;

        // Lấy Title
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : 'No title found';

        // Lấy Meta Description hoặc OG Description
        let description = '';
        const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i);
        const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i);

        if (ogDescMatch) description = ogDescMatch[1];
        else if (metaDescMatch) description = metaDescMatch[1];

        return `Page Title: ${title}\nDescription: ${description}`;

    } catch (error) {
        console.error('[AI Service] Lỗi fetch URL content:', error.message);
        return null;
    }
};

export default ({ strapi }) => ({

    // BL-11: Script Generator (POST /api/ai/script)
    async generateScript({ url, platform, tone = 'professional' }) {
        let contextInfo = `Target URL: ${url}`;
        const scrapedData = await getContentFromUrl(url);

        if (scrapedData) {
            contextInfo += `\n\nContent Summary from URL:\n${scrapedData}`;
        } else {
            contextInfo += `\n(Note: Could not fetch content directly, please infer from URL structure)`;
        }

        const prompt = `
       Act as a professional content creator.
       Create short-form video content for ${platform} (TikTok / Instagram Reels / YouTube Shorts) based on the following information:
       ${contextInfo}
       Tone: ${tone}
       Content requirements:
       - Caption: A short, catchy line to grab attention immediately.
       - Script: The main content that delivers the key message, value proposition, or story.
       - Keywords: Relevant keywords or hashtags to improve reach and discoverability.
       Output format:
       Return ONLY a valid JSON object with the following keys:
       - "script" (string)
       - "caption" (string)
       - "keywords" (array of strings)
     `;

        try {
            const completion = await openai.chat.completions.create({
                messages: [{ role: 'user', content: prompt }],
                model: 'gpt-4.1',
                response_format: { type: "json_object" }
            });

            const content = completion.choices[0].message.content;

            return JSON.parse(content);
        } catch (error) {
            strapi.log.error('OpenAI Script Error:', error);
            throw new Error('Failed to generate script via AI');
        }
    },

    async generateAdInsights(linkId: number) {
        // Lấy dữ liệu click của link đó
        const clicks = await strapi.entityService.findMany('api::click.click', {
            filters: { link: linkId },
            sort: { createdAt: 'desc' },
            limit: 1000,
            fields: ['createdAt', 'country', 'device'],
        });

        if (!clicks || clicks.length < 5) {
            return { analysis: "Chưa đủ dữ liệu click để phân tích (cần tối thiểu 10 clicks)." };
        }

        // Gom nhóm theo giờ trong ngày
        const hoursDistribution = new Array(24).fill(0);
        clicks.forEach(click => {
            const date = new Date(click.createdAt);
            const hour = date.getHours();
            hoursDistribution[hour]++;
        });

        // Tạo prompt gửi OpenAI
        const prompt = `
      Below is the hourly click distribution (0h–23h) for a shortened link:
      ${JSON.stringify(hoursDistribution)}

      Total clicks: ${clicks.length}.

      Act as a Marketing expert. Based on this data:
      1. Identify the “Golden Hour” (the time range with the highest engagement).
      2. Recommend a specific ad scheduling strategy to optimize budget (e.g., which hours should have higher bids).
      3. Provide a brief insight into user behavior.

      Respond concisely in JSON format:
      {
        "goldenHour": "...",
        "adScheduleStrategy": "...",
        "insight": "..."
      }
    `;
        try {
            const completion = await openai.chat.completions.create({
                messages: [{ role: 'user', content: prompt }],
                model: 'gpt-4.1',
                response_format: { type: "json_object" }
            });

            const content = completion.choices[0].message.content;
            return JSON.parse(content);
        } catch (error) {
            strapi.log.error('OpenAI Insight Error:', error);
            throw new Error('Failed to generate insights via AI');
        }
    }
});