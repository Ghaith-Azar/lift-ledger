import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();

console.log('Add these three to your environment (.env locally, or Render\'s Environment tab):\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('VAPID_SUBJECT=mailto:azargaith1@gmail.com');
console.log(
  '\nReplace the email with your own — push services use it to contact you if your server misbehaves. ' +
    'Generate this once per deployment and keep the private key secret.'
);
