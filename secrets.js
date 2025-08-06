// secrets.js
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const client = new SecretManagerServiceClient();

const secrets = {}; // A cache to store the fetched secrets

async function getSecret(secretName) {
  if (secrets[secretName]) {
    return secrets[secretName];
  }

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

module.exports = { getSecret };