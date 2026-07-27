require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

puppeteer.use(StealthPlugin());

const CONFIG = {
  projectName: 'Osman Reklam',
  userDataPath: '/home/ubuntu/osman-reklam/user_data',
  targetUrl: 'https://ads.google.com/localservices/inbox?cid=2903573653&bid=10985702078&pid=9999999999&euid=3547106212&hl=de-AT&gl=AT',
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
};

async function sendTelegramMessage(lead) {
  if (!CONFIG.telegramToken || !CONFIG.telegramChatId) return;

  const message = `🔔 *YENİ MÜŞTERİ!* (${CONFIG.projectName})\n\n` +
                  `👤 *Müşteri:* ${lead["Musteri"]}\n` +
                  `📍 *Konum:* ${lead["Konum"]}\n` +
                  `💼 *Hizmet:* ${lead["Hizmet"]}\n` +
                  `📅 *İlk Görüşme:* ${lead["Ilk gorusme"]}\n` +
                  `⏳ *Son Görüşme:* ${lead["Son gorusme"]}\n` +
                  `💬 *Mesaj:* ${lead["Mesaj"]}`;

  try {
    await fetch(`https://api.telegram.org/bot${CONFIG.telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CONFIG.telegramChatId,
        text: message,
        parse_mode: 'Markdown'
      })
    });
  } catch (err) {
    console.error('⚠️ Telegram hatası:', err.message);
  }
}

function parseTo24HourDate(dateStr) {
  if (!dateStr || dateStr === '-') return '-';
  const fixedStr = dateStr.replace(/(\b\d{1,2})(\d{2})\s*(AM|PM)/gi, '$1:$2 $3');
  const match = fixedStr.match(/(\d{2}\.\d{2}\.\d{2})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!match) return dateStr;

  let [, datePart, hoursStr, minutes, modifier] = match;
  let hours = parseInt(hoursStr, 10);

  if (modifier) {
    if (modifier.toUpperCase() === 'PM' && hours < 12) hours += 12;
    if (modifier.toUpperCase() === 'AM' && hours === 12) hours = 0;
  }
  return `${datePart} ${String(hours).padStart(2, '0')}:${minutes}`;
}

function clearChromeLocks() {
  const locks = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
  locks.forEach(lock => {
    const lockPath = path.join(CONFIG.userDataPath, lock);
    if (fs.existsSync(lockPath)) {
      try { fs.unlinkSync(lockPath); } catch (_) {}
    }
  });
}

(async () => {
  let browser;
  try {
    clearChromeLocks();

    browser = await puppeteer.launch({
      headless: "new",
      executablePath: '/usr/bin/google-chrome',
      userDataDir: CONFIG.userDataPath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1920,1080',
        '--lang=de-AT,de'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    page.setDefaultTimeout(90000);

    console.log("🚀 LSA Inbox yükleniyor...");
    await page.goto(CONFIG.targetUrl, { waitUntil: 'networkidle2' });

    const pageTitle = await page.title();
    console.log("Sayfa Başlığı:", pageTitle);

    if (/Anmelden|Sign in|YouTube|Error|504/i.test(pageTitle)) {
      throw new Error(`❌ Oturum açılamadı/Engellendi: ${pageTitle}`);
    }

    await page.evaluate(async () => {
      for (let i = 0; i < 3; i++) {
        window.scrollBy(0, 400);
        await new Promise(r => setTimeout(r, 250));
      }
    });
    await new Promise(r => setTimeout(r, 2000));

    // AŞAMA 1: VERİ TOPLAMA VE 'NACHRICHT' TESPİTİ
    const rawData = await page.evaluate(() => {
      const rowElements = Array.from(document.querySelectorAll('[role="row"], tr'));

      return rowElements.map((row) => {
        const cellElements = Array.from(row.querySelectorAll('td, div[role="gridcell"]'));
        const cells = cellElements.map(c => c.innerText?.trim() || '');

        if (cells.length < 4) return null;
        if (/Gebührenstatus|Kunde|Kundenname/i.test(row.innerText || '')) return null;

        const customerName = cells[0] || '-';
        const jobType = cells[1] || '-';

        // Müşteri VE Hizmet ikisi birden yoksa çöp satırdır
        if ((!customerName || customerName === '-') && (!jobType || jobType === '-')) return null;

        // Tek başına sayfa no/sayı içeriyorsa atla
        if (/^\d{1,3}$/.test(customerName) || /^\d{1,3}$/.test(jobType)) return null;

        // KONUM -> Karakter uzunluğu 2'den büyük olmalı
        let location = cells[3] || '-';
        if (!location || location.length <= 2 || location === jobType || /^\+?\d[\d\s-]{6,}$/.test(location)) {
          const candidate = cells.find((t, i) => 
            i > 1 && 
            t.length > 2 && 
            t !== customerName && 
            t !== jobType && 
            !/^\+?\d[\d\s-]{6,}$/.test(t) && 
            !/^(Kategorie|Direkte|Telefon|Nachricht|Belastet|Wird)/i.test(t) &&
            !/\d{2}\.\d{2}\.\d{2}/.test(t)
          );
          location = candidate || '-';
        }

        if ((!customerName || customerName === '-') && location.length <= 2) return null;

        const dates = cells.filter(t => /\d{2}\.\d{2}\.\d{2}/.test(t));
        
        // KONTROL: Hücrelerden herhangi birinde "Nachricht" yazıyor mu?
        const isMessage = cells.some(cell => cell.trim().toLowerCase() === 'nachricht');

        return {
          identifier: customerName, // Satırı DOM'da tekrar bulmak için benzersiz alan
          phone: customerName,
          jobType,
          location,
          anfrageDate: dates[0] || '-',
          letzteDate: dates[1] || dates[0] || '-',
          isMessage
        };
      }).filter(Boolean);
    });

    console.log(`📊 Çekilen Temiz Lead Sayısı: ${rawData.length}`);

    if (rawData.length === 0) {
      throw new Error("❌ Hiç geçerli veri bulunamadı.");
    }

    // AŞAMA 2: SADECE "NACHRICHT" OLANLARA TIKLA VE MESAJI ÇEK
    const leads = [];
    for (const item of rawData) {
      let messageText = "-";

      if (item.isMessage) {
        try {
          console.log(`💬 [${item.identifier}] Nachricht tespit edildi, tıklanıyor...`);

          const clicked = await page.evaluate((id) => {
            const rows = Array.from(document.querySelectorAll('[role="row"], tr'));
            const targetRow = rows.find(r => r.innerText && r.innerText.includes(id));
            if (targetRow) {
              targetRow.click();
              return true;
            }
            return false;
          }, item.identifier);

          if (clicked) {
            await new Promise(r => setTimeout(r, 4000));

            messageText = await page.evaluate(() => {
              const chatBlock = Array.from(document.querySelectorAll('div, section, article'))
                                    .find(el => (el.innerText || '').includes('Unterhaltung'));
              
              if (!chatBlock) return "-";

              return chatBlock.innerText.split('Unterhaltung').pop()
                         .split('Wird geladen')[0]
                         .split('Audioinhalte')[0]
                         .split('Hier dem Kunden')[0]
                         .replace(/^P\s+|^Potenzieller Kunde\s+|^\d{2}\.\d{2}\.\d{2}\s+/gi, '')
                         .trim() || "-";
            });

            console.log(` -> Okunan Mesaj: ${messageText.substring(0, 50)}...`);
          }
        } catch (e) {
          console.warn(`⚠️ [${item.identifier}] Mesaj okuma hatası:`, e.message);
        }
      }

      leads.push({
        "Musteri": item.phone,
        "Hizmet": item.jobType,
        "Konum": item.location,
        "Ilk gorusme": parseTo24HourDate(item.anfrageDate),
        "Son gorusme": parseTo24HourDate(item.letzteDate),
        "Mesaj": messageText
      });
    }

    // JSON KAYIT
    const outputData = {
      updatedAt: new Date().toLocaleString('de-AT', { timeZone: 'Europe/Vienna' }),
      leads
    };
    fs.writeFileSync('data.json', JSON.stringify(outputData, null, 2));
    console.log(`🎉 BAŞARILI! ${leads.length} veri kaydedildi.`);

    // AŞAMA 3: GIT PUSH & BİLDİRİM
    try {
      const gitStatus = execSync('git status --porcelain data.json').toString().trim();
      if (gitStatus) {
        console.log("⏳ GitHub Pages sync bekleniyor (10sn)...");
        await new Promise(r => setTimeout(r, 10000));

        execSync('git add data.json');
        execSync('git commit -m "Auto-update data.json [cron] [skip ci]" || true');
        execSync('git pull origin main --rebase -X ours');
        execSync('git push origin main');
        console.log("✅ Git Push Tamamlandı.");

        if (leads.length > 0) {
          await sendTelegramMessage(leads[0]);
        }
      } else {
        console.log("ℹ️ Veri değişmedi, Push atlandı.");
      }
    } catch (gitErr) {
      console.error("⚠️ Git Push Hatası:", gitErr.message);
    }

  } catch (error) {
    console.error("💥 Kritik Scraper Hatası:", error.message);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();
