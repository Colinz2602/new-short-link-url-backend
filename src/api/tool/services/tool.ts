/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import { factories } from '@strapi/strapi';
import puppeteer from 'puppeteer';

export default factories.createCoreService('api::tool.tool', ({ strapi }) => ({
    async scrapeFacebook(url: string) {
        let browser;
        try {
            // Khởi tạo trình duyệt (Headless mode)
            browser = await puppeteer.launch({
                headless: true, // Chạy ẩn không hiện UI trình duyệt
                args: ['--no-sandbox', '--disable-setuid-sandbox'], // Cần thiết cho môi trường server/docker
            });

            const page = await browser.newPage();

            // Giả lập User-Agent để tránh bị Facebook chặn (nhận diện là bot)
            await page.setUserAgent(
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36'
            );

            // Tối ưu: Chặn load hình ảnh/css để tăng tốc độ
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
                    req.abort();
                } else {
                    req.continue();
                }
            });

            // Truy cập URL, chờ mạng rảnh (networkidle2)
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

            // Thực thi code JavaScript trên trang để lấy dữ liệu Meta Tags
            const data = await page.evaluate(() => {
                const getMetaContent = (property: string) => {
                    const element = document.querySelector(`meta[property="${property}"]`) || document.querySelector(`meta[name="${property}"]`);
                    return element ? element.getAttribute('content') : null;
                };

                return {
                    title: getMetaContent('og:title') || document.title,
                    description: getMetaContent('og:description') || getMetaContent('description'),
                    image: getMetaContent('og:image'),
                    site_name: getMetaContent('og:site_name'),
                    type: getMetaContent('og:type'),
                    url: getMetaContent('og:url') || window.location.href,
                };
            });

            return data;

        } catch (error) {
            strapi.log.error('Scrape Error:', error);
            throw new Error(`Failed to scrape URL: ${error.message}`);
        } finally {
            // Luôn đóng trình duyệt sau khi xong
            if (browser) {
                await browser.close();
            }
        }
    }
}));