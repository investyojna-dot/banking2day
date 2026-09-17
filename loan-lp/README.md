# Banking2Day Loan Landing Page

Live at https://loan.banking2day.com — deployed on the banking2day EC2 host
(`ubuntu@13.233.11.221`) as systemd service `loan-app` on port 4001, proxied
by nginx with a Let's Encrypt cert.

## Runtime config
Set via `/etc/loan-app.env` on the server (not committed):
- `PORT` (4001)
- `META_PHONE_NUMBER_ID` — WhatsApp phone number ID (WABA 1520195849605409)
- `META_ACCESS_TOKEN` — system-user token, no expiry
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` — scoped IAM
  user `loan-app-dynamodb`, PutItem-only on `knox-media-leads`
- `LEADS_TABLE` (knox-media-leads)

## Flow
1. `/api/send-whatsapp-otp` — sends approved `b2d_loan_otp` AUTHENTICATION
   template via Meta Cloud API
2. `/api/verify-whatsapp-otp` — checks against in-memory OTP store (5 min TTL)
3. `/api/submit-lead` — writes to DynamoDB table `knox-media-leads`

## Deploy
```
scp *.js *.html *.css *.svg *.png ubuntu@13.233.11.221:/var/www/loan-app/
ssh ubuntu@13.233.11.221 sudo systemctl restart loan-app
```
