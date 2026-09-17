/* ==========================================================================
   BANKING2DAY - PURE NODE.JS SERVER WITH AUTOMATIC PORT SELECTION
   ========================================================================== */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DynamoDBClient, PutItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');

const ddb = new DynamoDBClient({ region: process.env.AWS_REGION || 'ap-south-1' });
const LEADS_TABLE = process.env.LEADS_TABLE || 'knox-media-leads';
const FUNNEL_TABLE = process.env.FUNNEL_TABLE || 'banking2day-otp-funnel';

function recordOtpRequested(mobile_number) {
    return ddb.send(new PutItemCommand({
        TableName: FUNNEL_TABLE,
        Item: {
            mobile_number: { S: mobile_number },
            requested_at: { S: new Date().toISOString() },
            otp_verified: { BOOL: false }
        }
    })).catch((e) => console.error('[Funnel record FAILED]', e.message));
}

function recordOtpVerified(mobile_number) {
    return ddb.send(new UpdateItemCommand({
        TableName: FUNNEL_TABLE,
        Key: { mobile_number: { S: mobile_number } },
        UpdateExpression: 'SET otp_verified = :v, verified_at = :t',
        ExpressionAttributeValues: { ':v': { BOOL: true }, ':t': { S: new Date().toISOString() } }
    })).catch((e) => console.error('[Funnel record FAILED]', e.message));
}

const AUDIENCE_BRAND = process.env.AUDIENCE_BRAND || 'banking2day';
const AUDIENCE_LIST_ID = process.env.AUDIENCE_LIST_ID || 'loan-lp-leads';
const AUDIENCE_LIST_NAME = 'Loan LP Leads';

function toE164(mobile) {
    const digits = String(mobile || '').replace(/\D/g, '');
    return digits.length === 10 ? `+91${digits}` : null;
}

const NETCORE_API_KEY = process.env.NETCORE_API_KEY;
const NETCORE_FROM_EMAIL = process.env.NETCORE_FROM_EMAIL || 'noreply@mail.banking2day.com';

const CC_OFFERS = [
    { name: 'IDFC FIRST Credit Card', benefit: '⭐ Zero Joining & Annual Fee', img: 'idfc_card.png', url: 'https://trk.trackgrove.com/click?campaign_id=491&pub_id=92' },
    { name: 'Scapia Credit Card', benefit: '✈️ Zero Forex Markup', img: 'scapia_card.png', url: 'https://click.vetronova.com/click?campaign_id=862&pub_id=92' },
    { name: 'IndusInd Credit Card', benefit: '💰 Rewards on Every Spend', img: 'indus_card.png', url: 'https://click.mintuaff.com/click?campaign_id=47&pub_id=92' }
];

function ccOffersHtml() {
    return CC_OFFERS.map((c) => `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden">
        <tr>
          <td style="padding:16px;text-align:center;background:#fafafa">
            <img src="https://loan.banking2day.com/${c.img}" alt="${c.name}" width="180" style="display:block;margin:0 auto 10px;border-radius:8px">
            <div style="font-family:sans-serif;font-weight:700;font-size:15px;color:#111827">${c.name}</div>
            <div style="font-family:sans-serif;font-size:13px;color:#4b5563;margin:6px 0 12px">${c.benefit}</div>
            <a href="${c.url}" style="display:inline-block;background:#16a34a;color:#ffffff;font-family:sans-serif;font-weight:700;font-size:13px;text-decoration:none;padding:10px 22px;border-radius:6px">Apply Now</a>
          </td>
        </tr>
      </table>`).join('');
}

function sendThankYouEmail({ toEmail, toName, refCode }) {
    return new Promise((resolve) => {
        if (!NETCORE_API_KEY || !toEmail) return resolve({ skipped: true });

        const payload = JSON.stringify({
            from: { email: NETCORE_FROM_EMAIL, name: 'Banking2Day' },
            subject: `We've received your loan application — Ref ${refCode}`,
            content: [{
                type: 'html',
                value: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
<p>Hi ${toName || 'there'},</p>
<p>Thanks for applying for a personal loan with Banking2Day. Your reference number is <b>${refCode}</b>.</p>
<p>We've received your details and will connect with you shortly. Banking2Day is an independent comparison partner, not a lender.</p>
<p>— Team Banking2Day</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
<p style="font-weight:700;font-size:15px;color:#111827">🔥 Recommended Pre-Approved Offers</p>
<p style="font-size:13px;color:#6b7280;margin-top:-8px">Claim your free credit card now</p>
${ccOffersHtml()}
</div>`
            }],
            personalizations: [{ to: [{ email: toEmail, name: toName || '' }] }],
            settings: { click_tracking: false, open_tracking: true }
        });

        const options = {
            hostname: 'emailapi.netcorecloud.net',
            port: 443,
            path: '/v5/mail/send',
            method: 'POST',
            headers: {
                'api_key': NETCORE_API_KEY,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => {
                try { resolve(JSON.parse(body)); } catch (e) { resolve({ raw: body }); }
            });
        });
        req.on('error', (e) => resolve({ error: e.message }));
        req.write(payload);
        req.end();
    });
}

const FB_PIXEL_ID = process.env.FB_PIXEL_ID || '2053705385262833';
const FB_CAPI_TOKEN = process.env.FB_CAPI_ACCESS_TOKEN;
const sha256 = (v) => crypto.createHash('sha256').update(v.trim().toLowerCase()).digest('hex');

function sendFacebookLeadEvent({ phone, eventId, sourceUrl, userAgent, clientIp }) {
    return new Promise((resolve) => {
        if (!FB_CAPI_TOKEN) return resolve({ skipped: 'FB_CAPI_ACCESS_TOKEN not set' });

        const payload = JSON.stringify({
            data: [{
                event_name: 'Lead',
                event_time: Math.floor(Date.now() / 1000),
                event_id: eventId,
                action_source: 'website',
                event_source_url: sourceUrl,
                user_data: {
                    ph: [sha256(phone.replace(/\D/g, ''))],
                    client_user_agent: userAgent || '',
                    client_ip_address: clientIp || ''
                }
            }]
        });

        const options = {
            hostname: 'graph.facebook.com',
            port: 443,
            path: `/v21.0/${FB_PIXEL_ID}/events?access_token=${FB_CAPI_TOKEN}`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => {
                try { resolve(JSON.parse(body)); } catch (e) { resolve({ raw: body }); }
            });
        });
        req.on('error', (e) => resolve({ error: e.message }));
        req.write(payload);
        req.end();
    });
}

async function syncToAudience(record) {
    const phone = toE164(record.mobile_number);
    if (!phone) return;

    let isNewContact = true;
    try {
        await ddb.send(new PutItemCommand({
            TableName: 'cadence-contacts',
            Item: {
                pk: { S: `LIST#${AUDIENCE_BRAND}#${AUDIENCE_LIST_ID}` },
                sk: { S: `PHONE#${phone}` },
                brandId: { S: AUDIENCE_BRAND },
                listId: { S: AUDIENCE_LIST_ID },
                phone: { S: phone },
                name: { S: record.full_name || '—' },
                optIn: { BOOL: true },
                fields: { S: JSON.stringify({ email: record.email, city: record.city, emp_type: record.emp_type, reference_id: record.reference_id, utm_source: record.utm_source, utm_medium: record.utm_medium, utm_campaign: record.utm_campaign, utm_content: record.utm_content }) }
            },
            ConditionExpression: 'attribute_not_exists(pk)'
        }));
    } catch (e) {
        if (e.name === 'ConditionalCheckFailedException') isNewContact = false;
        else { console.error('[Audience sync FAILED]', e.message); return; }
    }

    if (!isNewContact) return;

    await ddb.send(new UpdateItemCommand({
        TableName: 'cadence-contacts',
        Key: { pk: { S: `LISTS#${AUDIENCE_BRAND}` }, sk: { S: `LIST#${AUDIENCE_LIST_ID}` } },
        UpdateExpression: 'SET brandId = if_not_exists(brandId, :b), listId = if_not_exists(listId, :l), #n = if_not_exists(#n, :n), fileName = if_not_exists(fileName, :f), uploadedAt = if_not_exists(uploadedAt, :u), #c = if_not_exists(#c, :c) ADD contacts :one, sendable :one',
        ExpressionAttributeNames: { '#n': 'name', '#c': 'columns' },
        ExpressionAttributeValues: {
            ':b': { S: AUDIENCE_BRAND },
            ':l': { S: AUDIENCE_LIST_ID },
            ':n': { S: AUDIENCE_LIST_NAME },
            ':f': { S: 'loan.banking2day.com' },
            ':u': { S: new Date().toISOString() },
            ':c': { S: JSON.stringify(['email', 'city', 'emp_type', 'reference_id']) },
            ':one': { N: '1' }
        }
    }));
}

let PORT = process.env.PORT || 3000;

// In-Memory OTP Store
const otpStore = {};

// ==========================================================================
// LIVE META WHATSAPP CLOUD API CREDENTIALS
// ==========================================================================
const META_CONFIG = {
    phoneNumberId: process.env.META_PHONE_NUMBER_ID || '1272590895938259',
    accessToken: process.env.META_ACCESS_TOKEN,
    templateName: 'b2d_loan_otp'
};

if (!META_CONFIG.accessToken) {
    console.error('FATAL: META_ACCESS_TOKEN env var is not set.');
    process.exit(1);
}

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.json': 'application/json'
};

function getJsonBody(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try { resolve(JSON.parse(body || '{}')); }
            catch(e) { resolve({}); }
        });
    });
}

function sendMetaWhatsApp(toNumber, otpCode) {
    return new Promise((resolve) => {
        const payload = JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: `91${toNumber}`,
            type: "template",
            template: {
                name: META_CONFIG.templateName,
                language: { code: "en_US" },
                components: [
                    { type: "body", parameters: [{ type: "text", text: otpCode }] },
                    {
                        type: "button",
                        sub_type: "url",
                        index: "0",
                        parameters: [{ type: "text", text: otpCode }]
                    }
                ]
            }
        });

        const options = {
            hostname: 'graph.facebook.com',
            port: 443,
            path: `/v25.0/${META_CONFIG.phoneNumberId}/messages`,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${META_CONFIG.accessToken}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };

        const apiReq = https.request(options, (res) => {
            let resBody = '';
            res.on('data', chunk => resBody += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(resBody)); }
                catch(e) { resolve({ raw: resBody }); }
            });
        });

        apiReq.on('error', (e) => resolve({ error: e.message }));
        apiReq.write(payload);
        apiReq.end();
    });
}


const server = http.createServer(async (req, res) => {
    
    // API Route: Send WhatsApp OTP
    if (req.method === 'POST' && req.url === '/api/send-whatsapp-otp') {
        const body = await getJsonBody(req);
        const mobile_number = body.mobile_number;

        if (!mobile_number || !/^[6-9]\d{9}$/.test(mobile_number)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'Invalid 10-digit mobile number' }));
        }

        const generatedOtp = Math.floor(1000 + Math.random() * 9000).toString();
        otpStore[mobile_number] = { otp: generatedOtp, expiresAt: Date.now() + 300000 };

        console.log(`[LIVE WhatsApp OTP Triggered] +91 ${mobile_number} | OTP: ${generatedOtp}`);

        recordOtpRequested(mobile_number);

        const metaRes = await sendMetaWhatsApp(mobile_number, generatedOtp);
        console.log('[Meta Live API Response]', metaRes);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            success: true,
            message: `OTP sent via WhatsApp to +91 ${mobile_number.substring(0, 2)}******${mobile_number.substring(8)}`,
            demo_otp: generatedOtp,
            meta_api_result: metaRes
        }));
    }

    // API Route: Verify WhatsApp OTP
    if (req.method === 'POST' && req.url === '/api/verify-whatsapp-otp') {
        const body = await getJsonBody(req);
        const { mobile_number, otp_code } = body;

        const record = otpStore[mobile_number];
        if (record && record.otp === otp_code && record.expiresAt > Date.now()) {
            delete otpStore[mobile_number];
            recordOtpVerified(mobile_number);

            const fbEventId = crypto.randomUUID();
            sendFacebookLeadEvent({
                phone: `91${mobile_number}`,
                eventId: fbEventId,
                sourceUrl: 'https://loan.banking2day.com/verify-otp',
                userAgent: req.headers['user-agent'],
                clientIp: (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim()
            }).then((r) => console.log('[FB CAPI Lead]', JSON.stringify(r)));

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, message: 'OTP verified successfully', fb_event_id: fbEventId }));
        } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'Incorrect OTP code entered' }));
        }
    }

    // API Route: Submit Lead & Save Reference ID
    if (req.method === 'POST' && req.url === '/api/submit-lead') {
        const body = await getJsonBody(req);
        const randomId = Math.floor(10000 + Math.random() * 90000);
        const refCode = `B2D-${randomId}`;

        const recordToSave = {
            reference_id: refCode,
            full_name: body.full_name,
            mobile_number: body.mobile_number,
            email: body.email,
            city: body.city,
            emp_type: body.emp_type || 'Salaried',
            click_id: body.click_id || '',
            campaign: body.campaign || '',
            utm_source: body.utm_source || '',
            utm_medium: body.utm_medium || '',
            utm_campaign: body.utm_campaign || '',
            utm_content: body.utm_content || '',
            utm_trackingid: body.utm_trackingid || '',
            submitted_at: new Date().toISOString()
        };

        try {
            await ddb.send(new PutItemCommand({
                TableName: LEADS_TABLE,
                Item: {
                    id: { S: crypto.randomUUID() },
                    source: { S: 'loan.banking2day.com' },
                    reference_id: { S: recordToSave.reference_id },
                    full_name: { S: recordToSave.full_name || '' },
                    mobile_number: { S: recordToSave.mobile_number || '' },
                    email: { S: recordToSave.email || '' },
                    city: { S: recordToSave.city || '' },
                    emp_type: { S: recordToSave.emp_type },
                    click_id: { S: recordToSave.click_id },
                    campaign: { S: recordToSave.campaign },
                    utm_source: { S: recordToSave.utm_source },
                    utm_medium: { S: recordToSave.utm_medium },
                    utm_campaign: { S: recordToSave.utm_campaign },
                    utm_content: { S: recordToSave.utm_content },
                    utm_trackingid: { S: recordToSave.utm_trackingid },
                    submitted_at: { S: recordToSave.submitted_at }
                }
            }));
        } catch (e) {
            console.error('[Lead Save FAILED]', e.message);
            res.writeHead(502, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'Could not save lead, please retry' }));
        }

        console.log(`[Lead Saved] Reference ID: ${refCode} | Name: ${recordToSave.full_name}`);

        try {
            await syncToAudience(recordToSave);
        } catch (e) {
            console.error('[Audience sync FAILED]', e.message);
        }

        sendThankYouEmail({
            toEmail: recordToSave.email,
            toName: recordToSave.full_name,
            refCode
        }).then((r) => console.log('[Thank-you email]', JSON.stringify(r)));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, reference_id: refCode }));
    }

    // Serve Static Files
    let filePath = path.join(__dirname, req.url === '/' || req.url.startsWith('/?') ? 'index.html' : req.url.split('?')[0]);
    const extname = path.extname(filePath);
    let contentType = MIME_TYPES[extname] || 'text/html';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            fs.readFile(path.join(__dirname, 'index.html'), (err, indexContent) => {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(indexContent, 'utf-8');
            });
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });

});

function startServer(port) {
    server.listen(port, () => {
        console.log(`=======================================================`);
        console.log(`🚀 Banking2Day Meta Server running at http://localhost:${port}`);
        console.log(`=======================================================`);
    }).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`Port ${port} in use, trying ${port + 1}...`);
            startServer(port + 1);
        }
    });
}

startServer(PORT);
