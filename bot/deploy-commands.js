import { REST, Routes } from 'discord.js';
import { env } from '../src/config/env.js';
import { COMMANDS } from './commands/index.js';

const body = COMMANDS.map((c) => c.data.toJSON());

if (!env.discord.token || !env.discord.clientId) {
  console.error('Missing DISCORD_TOKEN or DISCORD_CLIENT_ID — copy .env.example to .env first.');
  process.exit(1);
}

const rest = new REST().setToken(env.discord.token);
const route = env.discord.devGuildId
  ? Routes.applicationGuildCommands(env.discord.clientId, env.discord.devGuildId)
  : Routes.applicationCommands(env.discord.clientId);

try {
  const deployed = await rest.put(route, { body });
  console.log(
    `Deployed ${deployed.length} slash commands ` +
      (env.discord.devGuildId
        ? `to dev guild ${env.discord.devGuildId} (instant).`
        : 'globally (may take up to an hour to appear).'),
  );
} catch (err) {
  console.error('Command deployment failed:', err);
  process.exit(1);
}
