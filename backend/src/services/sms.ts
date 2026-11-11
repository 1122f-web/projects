import { logger } from '../lib/logger.js';

interface SendSmsParams {
  to: string;
  message: string;
}

/**
 * Helper function to send SMS notifications.
 * If API credentials are not set in .env, it logs that delivery was skipped.
 */
export async function sendSMS({ to, message }: SendSmsParams): Promise<boolean> {
  const smsApiUrl = process.env.SMS_API_URL;
  const apiKey = process.env.SMS_API_KEY;
  const partnerId = process.env.SMS_PARTNER_ID;
  const shortcode = process.env.SMS_SENDER_ID;

  const cleanedPhone = to.trim();

  if (!cleanedPhone) {
    logger.warn('[SMS] Skipped because the phone number is empty');
    return false;
  }

  // Development fallback: do not log message contents, which may contain health information.
  if (!smsApiUrl || !apiKey) {
    logger.info('[SMS] Mock notification skipped because gateway credentials are not configured');
    return true;
  }

  try {
    const response = await fetch(smsApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        apikey: apiKey,
        partnerID: partnerId,
        shortcode: shortcode,
        mobile: cleanedPhone,
        message: message,
      }),
    });

    if (!response.ok) {
      logger.error({ status: response.status }, '[SMS] Gateway rejected the request');
      return false;
    }

    return true;
  } catch (error) {
    logger.error({ err: error }, '[SMS] Failed to send notification');
    return false; // Prevent breaking the main application logic if SMS fails
  }
}