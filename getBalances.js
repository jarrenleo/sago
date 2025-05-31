import { config } from "dotenv";
config();

async function fetchCaptchaSolverBalance(url, apiKey) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientKey: apiKey,
    }),
  });

  const data = await response.json();
  if (data.errorId !== 0) return null;

  return data.balance;
}

async function fetchSMSActivateBalance() {
  const response = await fetch(
    `https://api.sms-activate.ae/stubs/handler_api.php?api_key=${process.env.SMSACTIVATE_API_KEY}&action=getBalance`
  );
  const data = await response.text();

  const balance = +data.split(":")[1];

  return balance;
}

export default async function getBalances() {
  const results = await Promise.allSettled([
    fetchCaptchaSolverBalance(
      "https://api.2captcha.com/getBalance",
      process.env["2CAPTCHA_API_KEY"]
    ),
    fetchCaptchaSolverBalance(
      "https://api.capmonster.cloud/getBalance",
      process.env["CAPMONSTER_API_KEY"]
    ),
    fetchCaptchaSolverBalance(
      "https://api.capsolver.com/getBalance",
      process.env["CAPSOLVER_API_KEY"]
    ),
    fetchSMSActivateBalance(),
  ]);

  const balances = results.map((result) => {
    return result.status === "fulfilled" && result.value
      ? result.value.toFixed(2)
      : "-";
  });

  return balances;
}
