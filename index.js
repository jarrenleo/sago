import { config } from "dotenv";
import {
  Client,
  GatewayIntentBits,
  Events,
  AttachmentBuilder,
  ActivityType,
} from "discord.js";
import getBalances from "./getBalances.js";
import sortBy from "lodash.sortby";
config();

let statusUpdateInterval = null;
let currentIntervalDuration = 1;

const channels = {
  POPMART: [
    "1300043362920824843",
    "1315619535075803207",
    "1319343319322460160",
  ],
  TKT: [
    "1246706370049216564",
    "1246706524735279144",
    "1296405496038817812",
    "1246706689508511825",
    "1246706908354576444",
    "1297879088547233842",
    "1297879193178214452",
    "1297879210760601691",
    "1297879257996988438",
    "1297879412527595561",
  ],
  TSPLASH: ["1214264843658469396"],
  XBOT: ["1179970401468690432", "1326218929487482981", "1214265334572384326"],
};

const POPMART_CHANNEL_ID_SET = new Set(channels.POPMART);
const TKT_CHANNEL_ID_SET = new Set(channels.TKT);
const TSPLASH_CHANNEL_ID_SET = new Set(channels.TSPLASH);
const XBOT_CHANNEL_ID_SET = new Set(channels.XBOT);

function initialiseClient() {
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

function checkIntervalDuration(string) {
  const regex = /^\d+m$/;
  const minutes = parseInt(string.slice(0, -1));

  return regex.test(string) && minutes >= 1;
}

function startStatusUpdateInterval(client, intervalMinutes) {
  if (statusUpdateInterval) clearInterval(statusUpdateInterval);

  statusUpdateInterval = setInterval(async () => {
    try {
      const [capMonsterBalance, capSolverBalance, smsActivateBalance] =
        await getBalances();

      client.user.setActivity(
        `CapMonster: ${capMonsterBalance}\nCapSolver: ${capSolverBalance}\nSMSActivate: ${smsActivateBalance}\n\nLast updated: ${new Date().toLocaleString(
          "en-US",
          { timeZone: "Asia/Singapore" }
        )}`,
        {
          type: ActivityType.Watching,
        }
      );
    } catch (error) {
      console.error(error.message);
    }
  }, 1000 * 60 * intervalMinutes);

  currentIntervalDuration = intervalMinutes;
}

function checkCartTTL(string) {
  const regex = /^\d+m$/;
  return regex.test(string);
}

function hasMatchingEventId(targetEventId, embedFields) {
  if (!embedFields) return false;

  for (const field of embedFields) {
    if (
      field.name.toLowerCase().includes("event") &&
      field.value.toLowerCase().includes(targetEventId)
    )
      return true;
  }
  return false;
}

function replacePopmartField(value) {
  return value
    .replace(/^\|\|(.*)\|\|$/, "$1")
    .replace(/\[CLICK\]\((.*?)\)/, "$1")
    .replace(/[()]/g, "");
}

function replaceTktField(value) {
  return value.replace(/^\|\|(.*)\|\|$/, "$1").replace(/,/g, " &");
}

function replaceTSplashField(value) {
  return value
    .replace(/^\|\|(.*)\|\|$/, "$1")
    .replace(/,/g, "&")
    .replace(/\n/g, " ");
}

function replaceXBotField(value) {
  return value
    .replace(/^\|\|(.*)\|\|$/, "$1")
    .replace(/```/g, "")
    .replace(/,/g, "&")
    .replace(/\n/g, " ")
    .replace(/\[Payment Link\]\((.*?)\)/, "$1");
}

function extractFieldData(channelId, channelName, embedData, messageObject) {
  const embedFields = embedData.fields;
  const messageLink = `https://discord.com/channels/${messageObject.guildId}/${channelId}/${messageObject.id}`;

  const extractedFields = embedFields.reduce((acc, field) => {
    let value;
    if (POPMART_CHANNEL_ID_SET.has(channelId))
      value = replacePopmartField(field.value);
    if (TKT_CHANNEL_ID_SET.has(channelId)) value = replaceTktField(field.value);
    if (TSPLASH_CHANNEL_ID_SET.has(channelId))
      value = replaceTSplashField(field.value);
    if (XBOT_CHANNEL_ID_SET.has(channelId))
      value = replaceXBotField(field.value);

    acc[field.name] = value;

    return acc;
  }, {});

  if (embedData.url)
    return {
      Channel: channelName,
      "ATC Link": embedData.url,
      "Message Link": messageLink,
      ...extractedFields,
    };

  return {
    Channel: channelName,
    "Message Link": messageLink,
    ...extractedFields,
  };
}

async function fetchMessages(client, channelId, cartTTL, eventId) {
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
      const messageObject = message[1];

      const embed = messageObject.embeds;
      if (!embed.length) continue;

      expiredCheckout =
        Date.now() - +messageObject.createdTimestamp > cartTTL * 60 * 1000;
      if (expiredCheckout) return data;

      const embedData = embed[0].data;
      if (POPMART_CHANNEL_ID_SET.has(channelId)) {
        data.push(
          extractFieldData(channelId, channel.name, embedData, messageObject)
        );
        continue;
      }

      if (!hasMatchingEventId(eventId, embedData?.fields)) continue;
      data.push(
        extractFieldData(channelId, channel.name, embedData, messageObject)
      );
    }
    lastMessageId = messages.last()?.id;
  }
}

function convertToCSV(data) {
  const array = [Object.keys(data[0])].concat(data);
  return array.map((it) => Object.values(it).toString()).join("\n");
}

async function sendDM(m, eventId, cartTTL, csv) {
  const buffer = Buffer.from(csv, "utf-8");
  const attachment = new AttachmentBuilder(buffer, {
    name: `${eventId}_${cartTTL}_${Date.now()}.csv`,
  });

  const userDM = await m.author.createDM();
  userDM.send({
    files: [attachment],
  });
}

function sendErrorMessage(m, errorMessage) {
  m.reply({ content: errorMessage });
}

async function main() {
  const client = initialiseClient();

  client.once(Events.ClientReady, () => {
    startStatusUpdateInterval(client, currentIntervalDuration);
  });

  client.on(Events.MessageCreate, async (m) => {
    // Get Current Interval
    if (m.content.startsWith("!getinterval")) {
      m.reply(
        `Current activity update interval: ${currentIntervalDuration} minute(s).`
      );
      return;
    }

    // Set Interval
    if (m.content.startsWith("!setinterval")) {
      const [_, intervalString] = m.content.trim().split(" ");

      if (!intervalString) {
        sendErrorMessage(
          m,
          "Please specify an interval duration. E.g. !setinterval 3m"
        );
        return;
      }

      if (!checkIntervalDuration(intervalString)) {
        sendErrorMessage(
          m,
          "Please specify a valid interval duration. E.g. !setinterval 3m"
        );
        return;
      }

      const intervalMinutes = parseInt(intervalString.slice(0, -1));
      startStatusUpdateInterval(client, intervalMinutes);

      m.reply(
        `Activity update interval changed to ${intervalMinutes} minute(s).`
      );
      return;
    }

    // Get Balances
    if (m.content.startsWith("!balance")) {
      const [capMonsterBalance, capSolverBalance, smsActivateBalance] =
        await getBalances();

      m.reply(
        `CapMonster: ${capMonsterBalance}\nCapSolver: ${capSolverBalance}\nSMSActivate: ${smsActivateBalance}`
      );
      return;
    }

    // Extract
    if (m.content.startsWith("!extract")) {
      if (!POPMART_CHANNEL_ID_SET.has(m.channelId)) {
        sendErrorMessage(m, "Please use this command in a popmart channel.");
        return;
      }

      const [_, cartTTLString] = m.content.trim().split(" ");
      if (!checkCartTTL(cartTTLString)) {
        sendErrorMessage(m, "Please specify cart time to live. E.g. 1m.");
        return;
      }

      const cartTTL = +cartTTLString.slice(0, -1);
      const data = await fetchMessages(client, m.channelId, cartTTL);
      if (!data.length) {
        sendErrorMessage(
          m,
          `No available products found in the last ${cartTTLString}.`
        );
        return;
      }

      const csv = convertToCSV(data);
      await sendDM(m, "Popmart", cartTTLString, csv);
    }

    if (m.content.startsWith("!sort") || m.content.startsWith("!merge")) {
      if (
        !TKT_CHANNEL_ID_SET.has(m.channelId) &&
        !TSPLASH_CHANNEL_ID_SET.has(m.channelId) &&
        !XBOT_CHANNEL_ID_SET.has(m.channelId)
      ) {
        sendErrorMessage(
          m,
          "Please use this command in a supported ticket channel."
        );
        return;
      }

      const [_, eventIdString, cartTTLString] = m.content.trim().split(" ");
      if (!eventIdString) {
        sendErrorMessage(m, "Please specify event ID.");
        return;
      }
      if (!checkCartTTL(cartTTLString)) {
        sendErrorMessage(m, "Please specify cart time to live. E.g. 1m.");
        return;
      }

      const eventId = eventIdString.toLowerCase();
      const cartTTL = +cartTTLString.slice(0, -1);
      const noAvailableTicketsMessage = `No available tickets found for ${eventIdString} in the last ${cartTTLString}.`;

      // Sort
      if (m.content.startsWith("!sort")) {
        const data = await fetchMessages(client, m.channelId, cartTTL, eventId);
        if (!data.length) {
          sendErrorMessage(m, noAvailableTicketsMessage);
          return;
        }

        let sortedData;

        if (TKT_CHANNEL_ID_SET.has(m.channelId))
          sortedData = sortBy(data, ["Location"]);
        if (TSPLASH_CHANNEL_ID_SET.has(m.channelId))
          sortedData = sortBy(data, ["Seat Info"]);
        if (XBOT_CHANNEL_ID_SET.has(m.channelId))
          sortedData = sortBy(data, ["Seat No"]);

        const csv = convertToCSV(sortedData);
        await sendDM(m, eventIdString, cartTTLString, csv);
      }

      // Merge
      if (m.content.startsWith("!merge")) {
        let results;
        const data = [];

        if (TKT_CHANNEL_ID_SET.has(m.channelId))
          results = await Promise.allSettled(
            channels.TKT.map((channelId) =>
              fetchMessages(client, channelId, cartTTL, eventId)
            )
          );

        if (TSPLASH_CHANNEL_ID_SET.has(m.channelId))
          results = await Promise.allSettled(
            channels.TSPLASH.map((channelId) =>
              fetchMessages(client, channelId, cartTTL, eventId)
            )
          );

        if (XBOT_CHANNEL_ID_SET.has(m.channelId))
          results = await Promise.allSettled(
            channels.XBOT.map((channelId) =>
              fetchMessages(client, channelId, cartTTL, eventId)
            )
          );

        for (const result of results) {
          if (result.status === "fulfilled") data.push(...result.value);
        }

        if (!data.length) {
          sendErrorMessage(m, noAvailableTicketsMessage);
          return;
        }

        const csv = convertToCSV(data);
        await sendDM(m, eventIdString, cartTTLString, csv);
      }
    }
  });
}

main();
