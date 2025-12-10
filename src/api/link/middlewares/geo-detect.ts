import geoip from 'geoip-lite';

export default (config, { strapi }) => {
    return async (ctx, next) => {
        // Lấy IP của người dùng
        let ip = ctx.request.header['x-forwarded-for'] || ctx.request.ip;

        // Xử lý trường hợp IP có dạng chuỗi "ip1, ip2" (do proxy)
        if (typeof ip === 'string' && ip.includes(',')) {
            ip = ip.split(',')[0].trim();
        }

        // Xử lý localhost
        if (ip === '::1' || ip === '127.0.0.1') {
            // Hardcode IP Việt Nam để test khi chạy local
            //ip = '14.161.22.11';
            ip = '8.8.8.8'; // US
        }

        // Tra cứu quốc gia
        const geo = geoip.lookup(ip);
        const country = geo ? geo.country : 'Unknown';
        ctx.state.userCountry = country;
        ctx.state.userIp = ip;

        console.log(`[GeoDetect] IP: ${ip} -> Country: ${country}`);
        await next();
    };
};