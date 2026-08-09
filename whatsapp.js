const env = require('../config/env');
const { query } = require('../config/db');

/**
 * Sends an order invoice to the customer's WhatsApp number using the
 * official WhatsApp Business Cloud API.
 *
 * ==> PLUG IN YOUR OWN CREDENTIALS <==
 * Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in .env.
 * You'll also need an approved message template in WhatsApp Manager
 * (Cloud API requires templates for business-initiated messages).
 *
 * This function logs every attempt to the notifications table
 * (sent/failed) regardless of outcome, so admins have an audit trail
 * even if the provider call fails.
 */
async function sendOrderInvoiceWhatsApp({ order, customerMobile }) {
  const payload = buildInvoicePayload(order);

  if (!env.whatsapp.accessToken || !env.whatsapp.phoneNumberId) {
    await logNotification({
      userId: order.customer_user_id,
      orderId: order.id,
      type: 'order_invoice',
      payload,
      status: 'failed',
      providerResponse: { error: 'WhatsApp credentials not configured in .env' },
    });
    return { sent: false, reason: 'WhatsApp credentials not configured' };
  }

  try {
    const url = `https://graph.facebook.com/${env.whatsapp.apiVersion}/${env.whatsapp.phoneNumberId}/messages`;

    // Example shape - adjust the template name/params to match the
    // template you create and get approved in WhatsApp Manager.
    const body = {
      messaging_product: 'whatsapp',
      to: customerMobile,
      type: 'template',
      template: {
        name: 'order_invoice', // must match an approved template name
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: order.order_number },
              { type: 'text', text: order.shop_name },
              { type: 'text', text: String(order.total_amount) },
            ],
          },
        ],
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.whatsapp.accessToken}`,
      },
      body: JSON.stringify(body),
    });

    const responseJson = await res.json();

    await logNotification({
      userId: order.customer_user_id,
      orderId: order.id,
      type: 'order_invoice',
      payload,
      status: res.ok ? 'sent' : 'failed',
      providerResponse: responseJson,
    });

    return { sent: res.ok, providerResponse: responseJson };
  } catch (err) {
    await logNotification({
      userId: order.customer_user_id,
      orderId: order.id,
      type: 'order_invoice',
      payload,
      status: 'failed',
      providerResponse: { error: err.message },
    });
    return { sent: false, reason: err.message };
  }
}

function buildInvoicePayload(order) {
  return {
    platform_name: env.appName,
    order_id: order.order_number,
    shop_name: order.shop_name,
    items: order.items,
    subtotal: order.subtotal,
    delivery_charge: order.delivery_charge,
    tax_amount: order.tax_amount,
    total_amount: order.total_amount,
    payment_method: order.payment_method,
    placed_at: order.placed_at,
  };
}

async function logNotification({ userId, orderId, type, payload, status, providerResponse }) {
  await query(
    `INSERT INTO notifications (user_id, order_id, channel, type, payload, status, provider_response)
     VALUES ($1, $2, 'whatsapp', $3, $4, $5, $6)`,
    [userId || null, orderId, type, JSON.stringify(payload), status, JSON.stringify(providerResponse || {})]
  );
}

module.exports = { sendOrderInvoiceWhatsApp };
