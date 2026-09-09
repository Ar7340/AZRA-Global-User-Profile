import { Client, GatewayIntentBits, Partials } from 'discord.js';

/**
 * Gateway client. Privileged intents (GuildMembers, MessageContent) must be
 * enabled in the Developer Portal — see .env.example.
 */
export function createClient() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.GuildMember, Partials.Message, Partials.Reaction],
  });
}
