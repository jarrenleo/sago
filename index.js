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
const tSplashChannelId = "1214264843658469396";

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

function extractEmbedEventId(channelId, embedFields) {
  if (channelId === tSplashChannelId) return embedFields[1].value.toLowerCase();

  return embedFields[2].value.toLowerCase();
}

function extractEmbedFieldsData(channelId, channelName, embedData, messageObj) {
  const embedFields = embedData.fields;
  const messageLink = `https://discord.com/channels/${messageObj.guildId}/${channelId}/${messageObj.id}`;

  if (channelId === tSplashChannelId) {
    const seatInfo = embedFields[6].value.split("\n");
    const searchIndex = seatInfo[1].indexOf("-Price");

    return {
      channel: channelName,
      session: seatInfo[0].trimEnd(),
      mode: embedFields[3].value,
      quantity: embedFields[2].value,
      account: embedFields[7].value.slice(2, -2),
      proxy: embedFields[4].value.slice(2, -2),
      location: seatInfo[1].slice(0, searchIndex).replace(" , ", "-"),
      price: embedFields[5].value,
      checkout_link: embedData.url,
      cookie: embedFields[9].value,
      message_link: messageLink,
    };
  }

  return {
    channel: channelName,
    session: embedFields[4].value,
    mode: embedFields[5].value,
    quantity: embedFields[6].value,
    account: embedFields[7].value.slice(2, -2),
    proxy: embedFields[8].value.slice(2, -2),
    promo_code: embedFields[9].value.slice(2, -2),
    location: embedFields[10].value.split(",")[0],
    price: embedFields[11].value,
    checkout_link: embedFields.at(-1).value.slice(2, -2),
    message_link: messageLink,
  };
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
      const embedEventId = extractEmbedEventId(channelId, embedData.fields);
      if (eventId !== embedEventId) continue;

      data.push(
        extractEmbedFieldsData(channelId, channel.name, embedData, messageObj)
      );
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
