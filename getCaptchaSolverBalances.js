import { config } from "dotenv";
config();

async function fetchBalance(url, apiKey) {
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

export default async function getCaptchaSolverBalances() {
  const results = await Promise.allSettled([
    fetchBalance(
      "https://api.2captcha.com/getBalance",
      process.env["2CAPTCHA_API_KEY"]
    ),
    fetchBalance(
      "https://api.capmonster.cloud/getBalance",
      process.env["CAPMONSTER_API_KEY"]
    ),
    fetchBalance(
      "https://api.capsolver.com/getBalance",
      process.env["CAPSOLVER_API_KEY"]
    ),
  ]);

  const balances = results.map((result) => {
    return result.status === "fulfilled" ? result.value.toFixed(2) : "-";
  });

  return balances;
}
