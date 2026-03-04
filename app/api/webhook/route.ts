import { WhatsAppClient } from '@kapso/whatsapp-cloud-api';

const client = new WhatsAppClient({
  baseUrl: 'https://api.kapso.ai/meta/whatsapp',
  kapsoApiKey: process.env.KAPSO_API_KEY!
});

export async function POST(req:  Request) {
    const { event, data } = await req.json();

    console.log('Event:', event);
    console.log('Data:', data);

    // reply to the message
    await client.messages.sendText({
        phoneNumberId: process.env.PHONE_NUMBER_ID!,
        to: data[0]?.message?.from,
        body: "Received message!"
    })

    // Return 200 to acknowledge receipt
    return new Response('OK', { status: 200 });
}