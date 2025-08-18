// secrets.js
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const client = new SecretManagerServiceClient();

const secrets = {}; // A cache to store the fetched secrets
const secretNames = ['FRONTEND_URL', 'GCS_BUCKET_NAME', 'AIRTABLE_API_KEY', 'AIRTABLE_BASE_ID'];

async function initializeSecrets() {
  try {
    const promises = secretNames.map(secretName => {
      return client.accessSecretVersion({
        name: `projects/alpine-surge-466013-c0/secrets/${secretName}/versions/latest`,
      }).then(([version]) => {
        const payload = version.payload.data.toString('utf8');
        secrets[secretName] = payload;
      });
    });
    await Promise.all(promises);
    console.log('All secrets have been initialized successfully.');
  } catch (error) {
    console.error('Failed to initialize secrets:', error);
    throw new Error('Could not initialize secrets.');
  }
}

async function getSecret(secretName) {
  if (secrets[secretName]) {
    return secrets[secretName];
  }
  // This part of the function should ideally not be reached if initializeSecrets is called first.
  console.warn(`Secret "${secretName}" was not pre-initialized. Fetching it now.`);
  try {
    const [version] = await client.accessSecretVersion({
      name: `projects/alpine-surge-466013-c0/secrets/${secretName}/versions/latest`,
    });
    const payload = version.payload.data.toString('utf8');
    secrets[secretName] = payload;
    return payload;
  } catch (error) {
    console.error(`Failed to access secret "${secretName}":`, error);
    throw new Error(`Could not retrieve secret: ${secretName}`);
  }
}

module.exports = { getSecret, initializeSecrets };