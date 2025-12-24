import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import axios from 'axios';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parse } from 'csv-parse';

// Hàm helper để encode URL cho VirusTotal
const encodeUrlForVirusTotal = (url: string) => {
    return Buffer.from(url).toString('base64').replace(/=/g, '');
};

// Hàm tạo chuỗi ngẫu nhiên 5 ký tự
const generateSlug = (length = 5) => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

export default factories.createCoreService('api::link.link', ({ strapi }) => ({
    // Verify
    async verifyLink(url: string) {
        const { SAFE_BROWSING_KEY, VIRUS_TOTAL_KEY } = process.env;

        if (!SAFE_BROWSING_KEY || !VIRUS_TOTAL_KEY) {
            return { verified: false, isSafe: true, message: 'Missing API Keys' };
        }

        let isSafe = true;
        const reports: any = {};

        try {
            // Google Safe Browsing
            const safeBrowseResult = await axios.post(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${SAFE_BROWSING_KEY}`, {
                client: { clientId: 'strapi-link-shortener', clientVersion: '1.0.0' },
                threatInfo: {
                    threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE"],
                    platformTypes: ["ANY_PLATFORM"],
                    threatEntryTypes: ["URL"],
                    threatEntries: [{ url: url }]
                }
            });

            if (safeBrowseResult.data?.matches) {
                isSafe = false;
                reports.safeBrowsing = { flagged: true, matches: safeBrowseResult.data.matches };
            }

            // VirusTotal
            const vtEncodedUrl = encodeUrlForVirusTotal(url);
            try {
                const vtResult = await axios.get(`https://www.virustotal.com/api/v3/urls/${vtEncodedUrl}`, {
                    headers: { 'x-apikey': VIRUS_TOTAL_KEY }
                });
                const stats = vtResult.data?.data?.attributes?.last_analysis_stats;

                if (stats && stats.malicious >= 3) {
                    isSafe = false;
                    reports.virusTotal = { flagged: true, stats };
                }
            } catch (vtError: any) {
                if (vtError.response?.status !== 404) console.error('VT Error:', vtError.message);
            }

            return { verified: true, isSafe, reports };
        } catch (err: any) {
            console.error('Verify Error:', err.message);
            return { verified: false, isSafe: true, error: err.message };
        }
    },

    // POST /api/link/create từ hàm create của strapi
    async create(params) {
        const { data } = params;
        const { custom_slug, domain: domainId, users_permissions_user } = data;
        const ownerId = users_permissions_user;

        if (!data.original_url || !domainId) {
            throw new errors.ValidationError('Original URL and Domain are required');
        }

        try {
            const domain = await strapi.db.query('api::domain.domain').findOne({
                where: { id: domainId },
                populate: ['users_permissions_user']
            });

            if (!domain) {
                throw new errors.NotFoundError('Domain not found');
            }

            if (domain.type === 'custom') {
                if (domain.users_permissions_user?.id !== ownerId) {
                    throw new errors.ForbiddenError('Unauthorized domain use');
                }

                const sub = await strapi.db.query('api::subscription.subscription').findOne({
                    where: { users_permissions_user: ownerId }
                });

                const isValid = sub &&
                    ['bundle', 'annual', 'quarterly'].includes(sub.plan_type) &&
                    sub.active_until && new Date(sub.active_until) > new Date();

                if (!isValid) throw new errors.ForbiddenError('Plan upgrade required for custom domains');
            }

            let shortCode = custom_slug as string | undefined;

            if (!shortCode) {
                let isUnique = false;
                let attempts = 0;
                while (!isUnique && attempts < 10) {
                    shortCode = generateSlug(5);
                    const exist = await strapi.db.query('api::link.link').findOne({
                        where: { short_code: shortCode, domain: domainId }
                    });
                    if (!exist) isUnique = true;
                    attempts++;
                }
                if (!isUnique) throw new Error('Không thể tạo short code sau 10 lần thử');
            } else {
                if (shortCode.length < 5) throw new errors.ValidationError('Slug must be at least 5 chars');
                const exist = await strapi.db.query('api::link.link').findOne({
                    where: { short_code: shortCode, domain: domainId }
                });
                if (exist) throw new errors.ApplicationError('Slug already exists on this domain');
            }

            const rootDomain = process.env.ROOT_DOMAIN || 'localhost:3000';
            const fullHost = `${domain.domain_name}.${rootDomain}`;
            params.data.short_code = shortCode;
            const protocol = rootDomain.includes('localhost') ? 'http' : 'https';
            params.data.full_short_url = `${protocol}://${fullHost}/${shortCode}`;

            params.data.click_count = 0;
            delete params.data.custom_slug;

            const result = await super.create(params);
            return result;
        } catch (error: any) {
            throw error;
        }
    },

    // Logic Redirect
    async getRedirectTarget(slug: string, hostname: string, country: string) {
        const cleanHost = hostname.replace('www.', '').toLowerCase();
        const rootDomain = process.env.ROOT_DOMAIN || 'localhost:3000';

        let requestDomain = cleanHost;
        if (cleanHost.endsWith(`.${rootDomain}`)) {
            requestDomain = cleanHost.replace(`.${rootDomain}`, '');
        } else if (cleanHost === rootDomain) {
            requestDomain = 'public';
        }

        const links = await strapi.db.query('api::link.link').findMany({
            where: { short_code: slug },
            populate: { domain: true },
            select: ['original_url', 'state', 'geo_targeting', 'schedule_at', 'expire_at']
        });

        if (!links || links.length === 0) {
            throw new errors.NotFoundError(`Link not found`);
        }

        const link = links.find(l => {
            const dbDomainName = l.domain?.domain_name?.toLowerCase();
            return dbDomainName === requestDomain;
        });

        if (!link) {
            throw new errors.NotFoundError(`Link not found on brand "${requestDomain}"`);
        }

        const now = new Date();
        if (link.expire_at && now > new Date(link.expire_at)) {
            throw new errors.ForbiddenError('Link has expired');
        }
        if (link.schedule_at && now < new Date(link.schedule_at)) {
            throw new errors.ForbiddenError('Link has not started yet');
        }

        if (link.geo_targeting && (link.geo_targeting as any)[country]) {
            return (link.geo_targeting as any)[country];
        }

        return link.original_url;
    },
    // Bulk Import
    async processBulkImport(file: any, userId: number | string) {
        const results = { total: 0, success: 0, failed: 0, details: [] as any[] };
        const filePath = file.path || file.filepath;

        if (!filePath) throw new errors.ApplicationError('File path not found');

        const parser = fs.createReadStream(filePath).pipe(parse({
            columns: true, skip_empty_lines: true, trim: true, bom: true
        }));

        const publicDomain = await strapi.db.query('api::domain.domain').findOne({ where: { type: 'public' } });

        for await (const row of parser) {
            results.total++;
            const originalUrl = row.original_url || row.url;
            const csvDomainName = row.domain || row.domain_name;
            if (!originalUrl) {
                results.failed++;
                results.details.push({ originalUrl: 'N/A', error: 'Missing URL' });
                continue;
            }

            try {
                let targetDomainId = publicDomain?.id;
                if (csvDomainName) {
                    const foundDomain = await strapi.db.query('api::domain.domain').findOne({
                        where: { domain_name: csvDomainName }
                    });

                    if (foundDomain) {
                        targetDomainId = foundDomain.id;
                    } else {
                        throw new Error(`Domain "${csvDomainName}" không tồn tại hoặc bạn không có quyền.`);
                    }
                }
                const newLink = await this.create({
                    data: {
                        original_url: originalUrl,
                        custom_slug: row.custom_slug || row.slug,
                        domain: targetDomainId,
                        verified_safe: true,
                        users_permissions_user: userId,
                    }
                });

                results.success++;
                results.details.push({ originalUrl, shortUrl: newLink.full_short_url, status: 'success' });
            } catch (err: any) {
                results.failed++;
                results.details.push({ originalUrl, error: err.message, status: 'failed' });
            }
        }
        return results;
    },

    // Generate QR
    async generateQrCode(linkId: number | string, url: string) {
        if (!url) throw new errors.ApplicationError('URL required');

        const fileName = `qr-${linkId}-${Date.now()}.png`;
        const tempPath = path.join(os.tmpdir(), fileName);

        try {
            const qrBuffer = await QRCode.toBuffer(url, { width: 400, margin: 1 });
            await fs.promises.writeFile(tempPath, qrBuffer);
            const stats = await fs.promises.stat(tempPath);
            const result = await strapi.plugin('upload').service('upload').upload({
                data: {
                    refId: linkId,
                    ref: 'api::link.link',
                    field: 'qr_image',
                    fileInfo: {
                        name: fileName,
                        caption: `QR Code for Link ${linkId}`,
                        alternativeText: url
                    }
                },
                files: [{
                    name: fileName,
                    type: 'image/png',
                    size: stats.size,
                    path: tempPath,
                    filepath: tempPath,
                    tmpPath: tempPath,
                }]
            });

            const uploadedFile = Array.isArray(result) ? result[0] : result;

            return uploadedFile;
        } catch (error) {
            throw error;
        } finally {
            if (fs.existsSync(tempPath)) await fs.promises.unlink(tempPath).catch(() => { });
        }
    },
}));