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
  first: "1246706370049216564",
  "1a": "1246706524735279144",
  secondary: "1296405496038817812",
  third: "1246706689508511825",
  fufillPo: "1246706908354576444",
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

    for (const message of messages) {
      const messageObj = message[1];

      const embed = messageObj.embeds;
      if (!embed.length) continue;

      expiredCheckout =
        Date.now() - +messageObj.createdTimestamp > cartTTL * 60 * 1000;
      if (expiredCheckout) return data;

      const embedData = embed[0].data;
      const embedEventId = embedData.fields
        .find((field) => field.name === "Event ID")
        .value.toLowerCase();
      if (eventId !== embedEventId) continue;

      data.push({
        session: embedData.fields.find((field) => field.name === "Session")
          .value,
        quantity: embedData.fields.find((field) => field.name === "Quantity")
          .value,
        account: embedData.fields
          .find((field) => field.name === "Account")
          .value.slice(2, -2),
        promo_code: embedData.fields
          .find((field) => field.name === "Promo Code")
          .value.slice(2, -2),
        location: embedData.fields
          .find((field) => field.name === "Location")
          .value.split(",")
          .join(" +"),
        price: embedData.fields.find((field) => field.name === "Price").value,
        checkout_link: embedData.fields
          .find((field) => field.name === "Checkout Link")
          .value.slice(2, -2),
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
      results = await Promise.allSettled([
        fetchAndFilterMessages(client, channels.first, cartTTL, eventId),
        fetchAndFilterMessages(client, channels["1a"], cartTTL, eventId),
        fetchAndFilterMessages(client, channels.secondary, cartTTL, eventId),
        fetchAndFilterMessages(client, channels.third, cartTTL, eventId),
        fetchAndFilterMessages(client, channels["fufillPo"], cartTTL, eventId),
      ]);

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
