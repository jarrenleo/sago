import { config } from "dotenv";
import {
  Client,
  GatewayIntentBits,
  Events,
  AttachmentBuilder,
} from "discord.js";
import sortBy from "lodash.sortby";
config();

const channels = {
  c1: "1246706370049216564",
  c2: "1246706524735279144",
  c3: "1296405496038817812",
  c4: "1246706689508511825",
  c5: "1246706908354576444",
  c6: "1297879088547233842",
  c7: "1297879193178214452",
  c8: "1297879210760601691",
  c9: "1297879257996988438",
  c10: "1297879412527595561",
};

function init() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
  client.login(process.env.DISCORD_TOKEN);

  return client;
}

function checkCartTTL(string) {
  const regex = /^\d+m$/;
  return regex.test(string);
}

async function fetchAndFilterMessages(client, channelId, cartTTL, eventId) {
  const channel = await client.channels.fetch(channelId);

  const data = [];
  let expiredCheckout = false;
  let lastMessageId;

  while (!expiredCheckout) {
    const options = { limit: 100 };
    if (lastMessageId) options.before = lastMessageId;

    const messages = await channel.messages.fetch(options);
    if (!messages.size) {
      expiredCheckout = true;
      return data;
    }

    for (const message of messages) {
      const messageObj = message[1];

      const embed = messageObj.embeds;
      if (!embed.length) continue;

      expiredCheckout =
        Date.now() - +messageObj.createdTimestamp > cartTTL * 60 * 1000;
      if (expiredCheckout) return data;

      const embedData = embed[0].data;
      const embedEventId = embedData.fields[2].value.toLowerCase();
      if (eventId !== embedEventId) continue;

      data.push({
        channel: channel.name,
        session: embedData.fields[4].value,
        mode: embedData.fields[5].value,
        quantity: embedData.fields[6].value,
        account: embedData.fields[7].value.slice(2, -2),
        proxy: embedData.fields[8].value.slice(2, -2),
        promo_code: embedData.fields[9].value.slice(2, -2),
        location: embedData.fields[10].value.split(",")[0],
        price: embedData.fields[11].value,
        checkout_link: embedData.fields.at(-1).value.slice(2, -2),
        message_link: `https://discord.com/channels/${messageObj.guildId}/${channelId}/${messageObj.id}`,
      });
    }
    lastMessageId = messages.last()?.id;
  }
}

function convertToCSV(data) {
  const array = [Object.keys(data[0])].concat(data);
  return array.map((it) => Object.values(it).toString()).join("\n");
}

function sendCSV(m, eventId, cartTTL, csv) {
  const buffer = Buffer.from(csv, "utf-8");
  const attachment = new AttachmentBuilder(buffer, {
    name: `tickets_${eventId}_${cartTTL}.csv`,
  });

  m.reply({
    files: [attachment],
  });
}

function sendError(m, errorMessage) {
  m.reply({ content: errorMessage });
}

async function main() {
  const client = init();

  client.on(Events.MessageCreate, async (m) => {
    if (!m.content.startsWith("!sort") && !m.content.startsWith("!merge"))
      return;

    const [_, eventIdString, cartTTLString] = m.content.trim().split(" ");
    if (!eventIdString) {
      sendError(m, "Please specify event ID.");
      return;
    }
    if (!checkCartTTL(cartTTLString)) {
      sendError(m, "Please specify cart time to live. E.g. 1m.");
      return;
    }

    const data = [];
    const eventId = eventIdString.toLowerCase();
    const cartTTL = +cartTTLString.slice(0, -1);
    let results;

    if (m.content.startsWith("!sort"))
      results = await Promise.allSettled([
        fetchAndFilterMessages(client, m.channelId, cartTTL, eventId),
      ]);

    if (m.content.startsWith("!merge"))
      results = await Promise.allSettled(
        Object.values(channels).map((channelId) =>
          fetchAndFilterMessages(client, channelId, cartTTL, eventId)
        )
      );

    for (const result of results) {
      if (result.status === "fulfilled") data.push(...result.value);
    }
    if (!data.length) {
      sendError(
        m,
        `No available tickets found for ${eventIdString} in the last ${cartTTLString}.`
      );
      return;
    }

    const sortedData = sortBy(data, ["location"]);
    const csv = convertToCSV(sortedData);
    sendCSV(m, eventIdString, cartTTLString, csv);
  });
}

main();
