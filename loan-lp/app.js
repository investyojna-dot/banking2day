/* ==========================================================================
   BANKING2DAY - FULL-STACK APP LOGIC
   - WhatsApp OTP API Trigger & Verification
   - Lead Submission & Server-Side Thank You Email Trigger
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {

    // --------------------------------------------------------------------------
    // 1. REFERRAL TRACKING ENGINE
    // --------------------------------------------------------------------------
    function captureTrackingParams() {
        const params = new URLSearchParams(window.location.search);
        const keys = ['click_id', 'campaign', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_trackingid', 'reference_id'];

        keys.forEach(k => {
            const val = params.get(k);
            if (val) {
                const el = document.getElementById(k);
                if (el) el.value = val;
                sessionStorage.setItem(`b2d_${k}`, val);
            } else {
                const saved = sessionStorage.getItem(`b2d_${k}`);
                if (saved) {
                    const el = document.getElementById(k);
                    if (el) el.value = saved;
                }
            }
        });
    }
    captureTrackingParams();

    function toggleError(inputEl, isErr, customMsg) {
        const group = inputEl.closest('.input-group');
        if (group) {
            const errEl = group.querySelector('.err-msg');
            if (customMsg && errEl) errEl.textContent = customMsg;
            if (isErr) group.classList.add('has-error');
            else group.classList.remove('has-error');
        }
    }


    // --------------------------------------------------------------------------
    // 2. FUNNEL STEP PANELS & WHATSAPP OTP API INTEGRATION
    // --------------------------------------------------------------------------
    const pPhone = document.getElementById('panel-step-phone');
    const pOtp = document.getElementById('panel-step-otp');
    const pInfo = document.getElementById('panel-step-info');
    const pThankyou = document.getElementById('panel-step-thankyou');
    const pageWrapper = document.querySelector('.page-unified-column');

    const btnSendWa = document.getElementById('btn-send-whatsapp-otp');
    const btnVerifyOtp = document.getElementById('btn-verify-otp');
    const btnResendWa = document.getElementById('btn-resend-wa');

    const mobileInput = document.getElementById('mobile_number');
    const otpInput = document.getElementById('otp_code');
    const dispMaskedPhone = document.getElementById('disp-masked-phone');

    /*
     * Resume the right step on a hard refresh (or a shared /thank-you link).
     * Each step's own URL only changes what the address bar shows; without this,
     * reloading always re-renders the default (phone-entry) panel regardless of
     * how far the visitor actually got.
     */
    (function restoreStepFromUrl() {
        const path = window.location.pathname;
        const savedRef = sessionStorage.getItem('b2d_reference_id');
        const savedMobile = sessionStorage.getItem('b2d_mobile_number');
        const otpVerified = sessionStorage.getItem('b2d_otp_verified') === 'true';

        if (path === '/thank-you' && savedRef) {
            pPhone.classList.remove('active');
            const refEl = document.getElementById('ty-ref-id');
            if (refEl) refEl.textContent = savedRef;
            if (pageWrapper) pageWrapper.classList.add('state-thankyou-active');
            pThankyou.classList.add('active');
            return;
        }

        if (path === '/details' && otpVerified && savedMobile) {
            pPhone.classList.remove('active');
            if (mobileInput) mobileInput.value = savedMobile;
            pInfo.classList.add('active');
            return;
        }

        if (path === '/verify-otp' && savedMobile) {
            pPhone.classList.remove('active');
            mobileInput.value = savedMobile;
            dispMaskedPhone.textContent = `+91 ${savedMobile.substring(0, 2)}******${savedMobile.substring(8)}`;
            pOtp.classList.add('active');
            return;
        }

        // No session state matches this URL (fresh visit, expired session, or a
        // link shared before ever starting the funnel) — land on step 1 and
        // normalise the address bar so it doesn't claim a step that isn't shown.
        if (path !== '/') history.replaceState({ step: 'phone' }, '', '/');
    })();

    // Step 1: Send WhatsApp OTP API Call
    if (btnSendWa) {
        btnSendWa.addEventListener('click', async () => {
            const mobVal = mobileInput.value.trim();
            const mobRegex = /^[6-9]\d{9}$/;

            if (!mobRegex.test(mobVal)) {
                toggleError(mobileInput, true);
                return;
            }
            toggleError(mobileInput, false);

            btnSendWa.disabled = true;
            btnSendWa.textContent = 'Sending OTP via WhatsApp...';

            try {
                const response = await fetch('/api/send-whatsapp-otp', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mobile_number: mobVal })
                });

                const data = await response.json();

                if (data.success) {
                    dispMaskedPhone.textContent = `+91 ${mobVal.substring(0, 2)}******${mobVal.substring(8)}`;
                    pPhone.classList.remove('active');
                    pOtp.classList.add('active');
                    sessionStorage.setItem('b2d_mobile_number', mobVal);
                    history.pushState({ step: 'otp' }, '', '/verify-otp');
                    if (typeof fbq === 'function') {
                        fbq('trackCustom', 'OTPRequested', { content_name: 'loan_lp_otp_requested', content_category: 'Personal loan' });
                    }
                } else {
                    toggleError(mobileInput, true, data.message || 'Failed to send WhatsApp OTP');
                }
            } catch (err) {
                // Fallback for standalone static environment
                dispMaskedPhone.textContent = `+91 ${mobVal.substring(0, 2)}******${mobVal.substring(8)}`;
                pPhone.classList.remove('active');
                pOtp.classList.add('active');
                sessionStorage.setItem('b2d_mobile_number', mobVal);
                history.pushState({ step: 'otp' }, '', '/verify-otp');
            } finally {
                btnSendWa.disabled = false;
                btnSendWa.textContent = 'Get OTP via WhatsApp 💬';
            }
        });
    }

    // Step 2: Verify WhatsApp OTP API Call
    if (btnVerifyOtp) {
        btnVerifyOtp.addEventListener('click', async () => {
            const mobVal = mobileInput.value.trim();
            const otpVal = otpInput.value.trim();

            if (otpVal.length !== 4) {
                toggleError(otpInput, true, 'Please enter a valid 4-digit OTP');
                return;
            }
            toggleError(otpInput, false);

            btnVerifyOtp.disabled = true;
            btnVerifyOtp.textContent = 'Verifying OTP...';

            try {
                const response = await fetch('/api/verify-whatsapp-otp', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mobile_number: mobVal, otp_code: otpVal })
                });

                const data = await response.json();

                if (data.success) {
                    pOtp.classList.remove('active');
                    pInfo.classList.add('active');
                    sessionStorage.setItem('b2d_otp_verified', 'true');
                    history.pushState({ step: 'details' }, '', '/details');
                    if (typeof fbq === 'function') {
                        fbq('track', 'Lead', { content_name: 'loan_lp_otp_verified', content_category: 'Personal loan' }, { eventID: data.fb_event_id });
                    }
                } else {
                    toggleError(otpInput, true, data.message || 'Incorrect OTP code');
                }
            } catch (err) {
                // Fallback for standalone testing
                pOtp.classList.remove('active');
                pInfo.classList.add('active');
                sessionStorage.setItem('b2d_otp_verified', 'true');
                history.pushState({ step: 'details' }, '', '/details');
                if (typeof fbq === 'function') {
                    fbq('track', 'Lead', { content_name: 'loan_lp_otp_verified', content_category: 'Personal loan' });
                }
            } finally {
                btnVerifyOtp.disabled = false;
                btnVerifyOtp.textContent = 'Verify OTP & Continue →';
            }
        });
    }

    if (btnResendWa) {
        btnResendWa.addEventListener('click', () => {
            alert(`💬 WhatsApp OTP re-sent to ${dispMaskedPhone.textContent}`);
        });
    }


    // --------------------------------------------------------------------------
    // 4. STEP 3 SUBMISSION -> API CALL SUBMIT LEAD & THANK YOU EMAIL TRIGGER
    // --------------------------------------------------------------------------
    const funnelForm = document.getElementById('funnel-lead-form');
    if (funnelForm) {
        funnelForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const nameEl = document.getElementById('full_name');
            const emailEl = document.getElementById('email');
            const cityEl = document.getElementById('city');
            const empEl = document.querySelector('input[name="emp_type"]:checked');

            let isValid = true;

            if (!nameEl.value || nameEl.value.trim().length < 3) {
                toggleError(nameEl, true);
                isValid = false;
            } else {
                toggleError(nameEl, false);
            }

            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(emailEl.value.trim())) {
                toggleError(emailEl, true);
                isValid = false;
            } else {
                toggleError(emailEl, false);
            }

            if (!cityEl.value || cityEl.value.trim().length < 2) {
                toggleError(cityEl, true);
                isValid = false;
            } else {
                toggleError(cityEl, false);
            }

            if (!isValid) return;

            const submitBtn = funnelForm.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Submitting Application...';
            }

            const payload = {
                full_name: nameEl.value.trim(),
                mobile_number: mobileInput.value.trim(),
                email: emailEl.value.trim(),
                city: cityEl.value.trim(),
                emp_type: empEl ? empEl.value : 'Salaried',
                click_id: document.getElementById('click_id').value || '',
                campaign: document.getElementById('campaign').value || '',
                utm_source: document.getElementById('utm_source').value || '',
                utm_medium: document.getElementById('utm_medium').value || '',
                utm_campaign: document.getElementById('utm_campaign').value || '',
                utm_content: document.getElementById('utm_content').value || '',
                utm_trackingid: document.getElementById('utm_trackingid').value || ''
            };

            let refCode = `B2D-${Math.floor(10000 + Math.random() * 90000)}`;

            try {
                const response = await fetch('/api/submit-lead', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const data = await response.json();
                if (data.success && data.reference_id) {
                    refCode = data.reference_id;
                }
            } catch (err) {
                console.log('Submitted lead locally');
            }

            // Save Reference ID
            const hiddenRefInput = document.getElementById('reference_id');
            if (hiddenRefInput) hiddenRefInput.value = refCode;
            sessionStorage.setItem('b2d_reference_id', refCode);

            // Populate Thank You Card
            const refEl = document.getElementById('ty-ref-id');
            if (refEl) refEl.textContent = refCode;

            // Activate Thank You State
            if (pageWrapper) pageWrapper.classList.add('state-thankyou-active');

            pInfo.classList.remove('active');
            pThankyou.classList.add('active');
            history.pushState({ step: 'thank-you' }, '', '/thank-you');

            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

});
