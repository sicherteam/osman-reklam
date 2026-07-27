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
                  `📞 *Telefon:* ${lead["Telefon"]}\n` +
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

    // AŞAMA 1: MINIMAL & STANDORT BAZLI TABLO TARAMASI
    const rawData = await page.evaluate(() => {
      const rowElements = Array.from(document.querySelectorAll('[role="row"], tr'));
      let validRowCounter = 0;

      return rowElements.map((row) => {
        const cellElements = Array.from(row.querySelectorAll('td, div[role="gridcell"]'));
        const cells = cellElements.map(c => c.innerText?.trim() || '');

        // 1. Tablo başlığını veya yetersiz sütunlu DOM elemanlarını eler
        if (cells.length < 4 || /Gebührenstatus|Kunde|Kundenname/i.test(row.innerText || '')) {
          return null;
        }

        const customerName = cells[0] || '-';
        const jobType = cells[1] || '-';

        // 2. Yalnızca STANDORT (Konum) kontrolü:
        // Uzunluğu 2'den büyük olan VE içinde rakam barındırmayan hücreyi konum kabul et
        const locationCandidate = cells.find(t => 
          t && 
          t.length > 2 && 
          !/\d/.test(t) && 
          !/^(Kategorie|Direkte|Telefon|Nachricht|Belastet|Wird)/i.test(t)
        );

        const location = locationCandidate || '-';

        const dates = cells.filter(t => /\d{2}\.\d{2}\.\d{2}/.test(t));
        const isMessage = cells.some(cell => cell.trim().toLowerCase() === 'nachricht');

        const domIndex = validRowCounter;
        validRowCounter++;

        return {
          domIndex,
          customerName,
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

    // AŞAMA 2: SAF MESAJ VE DETAY OKUMA
    const leads = [];
    for (const item of rawData) {
      let messageText = "-";
      let extractedName = item.customerName;
      let extractedPhone = "Keine Telefonnummer";

      if (item.isMessage) {
        try {
          console.log(`\n💬 [Index: ${item.domIndex} | ${item.customerName}] Nachricht satırı açılıyor...`);

          const clicked = await page.evaluate((targetIndex) => {
            const rows = Array.from(document.querySelectorAll('[role="row"], tr')).filter(r => {
              const cells = Array.from(r.querySelectorAll('td, div[role="gridcell"]'));
              return cells.length >= 4 && !/Gebührenstatus|Kunde|Kundenname/i.test(r.innerText || '');
            });

            if (rows[targetIndex]) {
              const targetRow = rows[targetIndex];
              const targetCell = targetRow.querySelector('td, div[role="gridcell"]') || targetRow;
              targetCell.click();
              return true;
            }
            return false;
          }, item.domIndex);

          if (clicked) {
            await new Promise(r => setTimeout(r, 2000));

            const panelData = await page.evaluate(() => {
              let name = null;
              let phone = "Keine Telefonnummer";
              let msg = "-";

              const allDivs = Array.from(document.querySelectorAll('div, header, section'));
              
              // Mavi Header Barı (İsim ve Telefon)
              const headerBar = allDivs.find(el => {
                const txt = el.innerText || '';
                return txt.includes('ARCHIVIEREN') || txt.includes('MARKIEREN');
              });

              if (headerBar) {
                const headerText = headerBar.innerText || '';

                if (headerText.includes('Keine Telefonnummer')) {
                  phone = "Keine Telefonnummer";
                } else {
                  const phoneMatch = headerText.match(/(\+?\d[\d\s\/-]{6,15}\d)/);
                  if (phoneMatch) phone = phoneMatch[0].trim();
                }

                const headerLines = headerText.split('\n').map(l => l.trim()).filter(Boolean);
                if (headerLines.length > 0 && !headerLines[0].includes('ARCHIVIEREN')) {
                  name = headerLines[0].split('|')[0].trim();
                }
              }

              // Unterhaltung Mesaj İçeriği (Yazışma yanıt split'leri kaldırıldı)
              const chatCard = allDivs.find(el => (el.innerText || '').includes('Unterhaltung'));
              if (chatCard) {
                const rawChatText = chatCard.innerText;
                if (rawChatText.includes('Unterhaltung')) {
                  msg = rawChatText.split('Unterhaltung').pop()
                           .replace(/^Potenzieller Kunde/gi, '')
                           .trim();
                }
              }

              return { name, phone, msg };
            });

            if (panelData.name && panelData.name !== "Potenzieller Kunde") {
              extractedName = panelData.name;
            } else if (item.customerName !== "-") {
              extractedName = item.customerName;
            } else {
              extractedName = panelData.name || "-";
            }

            extractedPhone = panelData.phone;
            messageText = panelData.msg;

            console.log(` -> 👤 Müşteri: ${extractedName}`);
            console.log(` -> 📞 Telefon: ${extractedPhone}`);
            console.log(` -> ✉️ Mesaj: "${messageText.substring(0, 50)}..."`);
          }
        } catch (e) {
          console.warn(`⚠️ [Index: ${item.domIndex}] Okuma hatası:`, e.message);
        }
      }

      leads.push({
        "Musteri": extractedName,
        "Telefon": extractedPhone,
        "Hizmet": item.jobType,
        "Konum": item.location,
        "Ilk gorusme": parseTo24HourDate(item.anfrageDate),
        "Son gorusme": parseTo24HourDate(item.letzteDate),
        "Mesaj": messageText
      });
    }

    // AŞAMA 3: JSON KAYIT & GIT PUSH
    const outputData = {
      updatedAt: new Date().toLocaleString('de-AT', { timeZone: 'Europe/Vienna' }),
      leads
    };
    fs.writeFileSync('data.json', JSON.stringify(outputData, null, 2));
    console.log(`\n🎉 BAŞARILI! Toplam ${leads.length} lead işlendi ve kaydedildi.`);

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
