/**
 * Test script to manually trigger the PDF cleanup CRON job locally.
 */
require("dotenv").config({ path: ".env" });

async function run() {
  const CRON_SECRET = process.env.CRON_SECRET;
  
  if (!CRON_SECRET) {
    console.error("❌ CRON_SECRET não está definido no arquivo .env");
    process.exit(1);
  }

  console.log("🕒 Disparando rotina de limpeza de PDFs retidos...");
  console.log("URL: http://localhost:3000/api/cron/cleanup-pdfs");

  try {
    const response = await fetch("http://localhost:3000/api/cron/cleanup-pdfs", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${CRON_SECRET}`
      }
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`✅ Sucesso!`);
      console.log(`🗑️  PDFs expirados removidos: ${data.cleanedCount}`);
      console.log(`⏱️  Timestamp: ${data.timestamp}`);
    } else {
      console.error(`❌ Falha na requisição. Status: ${response.status} ${response.statusText}`);
      const text = await response.text();
      console.error("Detalhes:", text);
    }
  } catch (error) {
    console.error("❌ Erro ao conectar-se à API. A plataforma (Next.js) está rodando?", error.message);
  }
}

run();
