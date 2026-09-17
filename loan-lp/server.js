/* ==========================================================================
   BANKING2DAY - PURE NODE.JS SERVER WITH AUTOMATIC PORT SELECTION
   ========================================================================== */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');

const ddb = new DynamoDBClient({ region: process.env.AWS_REGION || 'ap-south-1' });
const LEADS_TABLE = process.env.LEADS_TABLE || 'knox-media-leads';

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
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, message: 'OTP verified successfully' }));
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
                    submitted_at: { S: recordToSave.submitted_at }
                }
            }));
        } catch (e) {
            console.error('[Lead Save FAILED]', e.message);
            res.writeHead(502, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'Could not save lead, please retry' }));
        }

        console.log(`[Lead Saved] Reference ID: ${refCode} | Name: ${recordToSave.full_name}`);

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
