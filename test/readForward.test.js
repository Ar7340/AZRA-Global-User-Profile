import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMessageLink,
  findForwardInMessages,
  parseForwardedMessage,
} from '../bot/commands/readForward.js';
import { COMMANDS } from '../bot/commands/index.js';

const EMBED = {
  author: { name: 'Boss Bot' },
  title: 'Guild Boss Defeated!',
  description: 'The boss has fallen.',
  fields: [
    { name: 'Top Damage', value: 'Keojin — 46,070', inline: false },
    { name: 'Rewards', value: '180 Weapon Shards', inline: true },
  ],
  footer: { text: 'defeated a day ago' },
  color: 0x57f287,
  image: { url: 'https://cdn.discordapp.com/embeds/dashboard.png' },
  thumbnail: { url: 'https://cdn.discordapp.com/embeds/icon.png' },
  timestamp: '2026-09-10T12:00:00.000Z',
};

function fakeMessage(overrides = {}) {
  return {
    author: { id: '200000000000000101', username: 'alice', displayName: 'Alice' },
    content: '',
    createdAt: null,
    embeds: [],
    attachments: [],
    components: [],
    messageSnapshots: { size: 0 },
    ...overrides,
  };
}

describe('parseMessageLink', () => {
  test('parses standard and client-variant links', () => {
    assert.deepEqual(
      parseMessageLink('https://discord.com/channels/300000000000000011/400000000000000022/500000000000000033'),
      { guildId: '300000000000000011', channelId: '400000000000000022', messageId: '500000000000000033' },
    );
    assert.equal(parseMessageLink('https://ptb.discord.com/channels/1/2/3')?.messageId, '3');
  });

  test('rejects non-links and malformed input', () => {
    assert.equal(parseMessageLink(null), null);
    assert.equal(parseMessageLink('not a link'), null);
    assert.equal(parseMessageLink('https://example.com/channels/1/2/3'), null);
  });
});

describe('findForwardInMessages', () => {
  test('returns the newest message carrying snapshots', () => {
    const plain = fakeMessage();
    const olderForward = fakeMessage({ messageSnapshots: { size: 1 } });
    const newestForward = fakeMessage({ messageSnapshots: { size: 1 } });
    const found = findForwardInMessages([plain, newestForward, olderForward, plain]);
    assert.equal(found, newestForward);
  });

  test('returns null when there is no forward', () => {
    assert.equal(findForwardInMessages([fakeMessage(), fakeMessage()]), null);
    assert.equal(findForwardInMessages([]), null);
    assert.equal(findForwardInMessages(null), null);
  });
});

describe('parseForwardedMessage', () => {
  test('reads snapshot embeds from a true forward', () => {
    const forward = fakeMessage({
      messageSnapshots: {
        size: 1,
        first: () => ({
          content: 'gg everyone',
          createdAt: '2026-09-10T12:00:00.000Z',
          embeds: [EMBED],
          attachments: [],
          components: [],
        }),
      },
    });
    const parsed = parseForwardedMessage(forward);
    assert.equal(parsed.isForward, true);
    assert.equal(parsed.embedCount, 1);
    assert.equal(parsed.forwardAuthor.username, 'alice');
    const emb = parsed.source.embeds[0];
    assert.equal(emb.title, 'Guild Boss Defeated!');
    assert.equal(emb.author, 'Boss Bot');
    assert.deepEqual(emb.fields.map((f) => f.name), ['Top Damage', 'Rewards']);
    assert.equal(emb.imageUrl, 'https://cdn.discordapp.com/embeds/dashboard.png');
    assert.equal(emb.footer, 'defeated a day ago');
  });

  test('falls back to direct embeds on non-forwarded messages', () => {
    const msg = fakeMessage({ content: 'plain message', embeds: [EMBED] });
    const parsed = parseForwardedMessage(msg);
    assert.equal(parsed.isForward, false);
    assert.equal(parsed.source.content, 'plain message');
    assert.equal(parsed.source.embeds[0].title, 'Guild Boss Defeated!');
  });

  test('handles embed with no fields and image-only forwards', () => {
    const imageOnly = fakeMessage({
      messageSnapshots: {
        size: 1,
        first: () => ({
          content: '',
          embeds: [],
          attachments: [{ url: 'https://cdn.discordapp.com/dashboard.png', contentType: 'image/png', name: 'dashboard.png', size: 60420 }],
          components: [],
        }),
      },
    });
    const parsed = parseForwardedMessage(imageOnly);
    assert.equal(parsed.embedCount, 0);
    assert.equal(parsed.attachmentCount, 1);
    assert.equal(parsed.source.attachments[0].contentType, 'image/png');
  });

  test('returns null-safe shape for null input', () => {
    assert.equal(parseForwardedMessage(null), null);
  });
});

describe('read-forward command registration', () => {
  test('is registered with data + execute', () => {
    const command = COMMANDS.find((c) => c.data.name === 'read-forward');
    assert.ok(command, 'read-forward must be registered');
    assert.equal(typeof command.execute, 'function');
  });
});
