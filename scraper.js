require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

puppeteer.use(StealthPlugin());

// --- CONFIGURATION ---
const CONFIG = {
  projectName: 'Osman Reklam',
  userDataPath: '/home/ubuntu/osman-reklam/user_data',
  targetUrl: 'https://ads.google.com/localservices/inbox?cid=2903573653&bid=10985702078&pid=9999999999&euid=3547106212&hl=de-AT&gl=AT',
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
};

// --- HELPER FUNCTIONS ---

// Native Fetch API with Telegram Alert
async function sendTelegramMessage(lead) {
  if (!CONFIG.telegramToken || !CONFIG.telegramChatId) {
    console.warn("⚠️ Telegram API bilgileri eksik (.env)");
    return;
  }

  const message = `🔔 *YENİ MÜŞTERİ!* (${CONFIG.projectName})\n\n` +
                  `👤 *Müşteri:* ${lead["Musteri"]}\n` +
                  `📍 *Konum:* ${lead["Konum"]}\n` +
                  `💼 *Hizmet:* ${lead["Hizmet"]}\n` +
                  `📅 *İlk Görüşme:* ${lead["Ilk gorusme"]}\n` +
                  `⏳ *Son Görüşme:* ${lead["Son gorusme"]}\n` +
                  `💬 *Mesaj:* ${lead["Mesaj"]}`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${CONFIG.telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CONFIG.telegramChatId,
        text: message,
        parse_mode: 'Markdown'
      })
    });
    if (res.ok) console.log('📱 Telegram bildirimi başarıyla gönderildi.');
  } catch (err) {
    console.error('⚠️ Telegram mesaj hatası:', err.message);
  }
}

// 24-Hour Strict Date Formatter
function parseTo24HourDate(dateStr) {
  if (!dateStr || dateStr === '-') return '-';

  const fixedStr = dateStr.replace(/(\b\d{1,2})(\d{2})\s*(AM|PM)/gi, '$1:$2 $3');
  const match = fixedStr.match(/(\d{2}\.\d{2}\.\d{2})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!match) return dateStr;

  let [, datePart, hoursStr, minutes, modifier] = match;
  let hours = parseInt(hoursStr, 10);

  if (modifier) {
    const isPM = modifier.toUpperCase() === 'PM';
    const isAM = modifier.toUpperCase() === 'AM';
    if (isPM && hours < 12) hours += 12;
    if (isAM && hours === 12) hours = 0;
  }

  return `${datePart} ${String(hours).padStart(2, '0')}:${minutes}`;
}

// Clear Chrome Locks
function clearChromeLocks() {
  const locks = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
  locks.forEach(lock => {
    const lockPath = path.join(CONFIG.userDataPath, lock);
    if (fs.existsSync(lockPath)) {
      try { fs.unlinkSync(lockPath); } catch (_) {}
    }
  });
}

// --- MAIN EXECUTION ---
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

    console.log("LSA Inbox sayfasına gidiliyor...");
    await page.goto(CONFIG.targetUrl, { waitUntil: 'networkidle2' });

    const pageTitle = await page.title();
    console.log("Sayfa Başlığı:", pageTitle);

    if (/Anmelden|Sign in|YouTube|Error|504|Serverfehler/i.test(pageTitle)) {
      throw new Error(`❌ Oturum açılamadı veya Google engelledi! Başlık: ${pageTitle}`);
    }

    // Lazy load tetiklemek için smooth scroll
    await page.evaluate(async () => {
      for (let i = 0; i < 4; i++) {
        window.scrollBy(0, 300);
        await new Promise(r => setTimeout(r, 200));
      }
    });
    await new Promise(r => setTimeout(r, 2000));

    // 1. AŞAMA: TABLO VERİLERİNİ HASSAS FİLTRELEME İLE ÇEKME
    const validRows = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('[role="row"], tr'));

      return rows.map((row, idx) => {
        const rawCells = Array.from(row.querySelectorAll('td, div[role="gridcell"]'));
        const cells = rawCells.map(c => c.innerText?.trim() || '').filter(Boolean);

        // En az 4 hücre yoksa veya başlık satırıysa atla
        if (cells.length < 4) return null;
        if (/Gebührenstatus|Kunde|Kundenname/i.test(row.innerText || '')) return null;

        const customerName = cells[0] || '-';
        const jobType = cells[1] || '-';

        // GÜVENLİK FİLTRESİ 1: Sadece saf rakamlardan oluşan takvim/hayalet satırlarını ele ("6", "7", "9" vb.)
        if (/^\d+$/.test(customerName) && /^\d+$/.test(jobType)) return null;

        // GÜVENLİK FİLTRESİ 2: Müşteri adı tek başına küçük sayı ise ele
        if (/^\d{1,3}$/.test(customerName)) return null;

        // KONUM TESPİTİ (4. Hücre yani index 3 doğrudan Standort'tur, yedekli doğrulama)
        let location = cells[3] || '-';
        if (!location || location === '-' || location === jobType || /^\+?\d[\d\s-]{6,}$/.test(location)) {
          location = cells.find((t, i) => 
            i > 1 && 
            t !== customerName && 
            t !== jobType && 
            !/^\+?\d[\d\s-]{6,}$/.test(t) && 
            !/^(Kategorie|Direkte|Telefon|Nachricht|Belastet|Wird)/i.test(t) &&
            !/\d{2}\.\d{2}\.\d{2}/.test(t)
          ) || '-';
        }

        const dates = cells.filter(t => /\d{2}\.\d{2}\.\d{2}/.test(t));

        return {
          domIndex: idx,
          phone: customerName,
          jobType,
          location,
          anfrageDate: dates[0] || '-',
          letzteDate: dates[1] || dates[0] || '-',
          isMessage: /nachricht|message/i.test(row.innerText || '')
        };
      }).filter(Boolean);
    });

    console.log(`📊 Çekilen Temiz Lead Sayısı: ${validRows.length}`);

    if (validRows.length === 0) {
      throw new Error("❌ Hiç veri bulunamadı! Sayfa yüklenemedi veya Google yapıyı değiştirdi.");
    }

    // 2. AŞAMA: MESAJ DETAYLARINI ALMA
    const leads = [];
    for (const item of validRows) {
      let messageText = "-";

      if (item.isMessage) {
        try {
          await page.evaluate((index) => {
            const rows = Array.from(document.querySelectorAll('[role="row"], tr'));
            const row = rows[index];
            if (row) (row.querySelector('td, div[role="gridcell"]') || row).click();
          }, item.domIndex);

          await new Promise(r => setTimeout(r, 4000));

          messageText = await page.evaluate(() => {
            const chatBlock = Array.from(document.querySelectorAll('div, section, article'))
                                  .find(el => (el.innerText || '').includes('Unterhaltung'));
            
            if (!chatBlock) return "-";

            let text = chatBlock.innerText.split('Unterhaltung').pop();
            return text.split('Wird geladen')[0]
                       .split('Audioinhalte')[0]
                       .split('Hier dem Kunden')[0]
                       .replace(/^P\s+|^Potenzieller Kunde\s+|^\d{2}\.\d{2}\.\d{2}\s+/gi, '')
                       .trim() || "-";
          });
        } catch (e) {
          console.warn(`[${item.phone}] Mesaj okuma uyarısı:`, e.message);
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

    // JSON Kayıt
    const outputData = {
      updatedAt: new Date().toLocaleString('de-AT', { timeZone: 'Europe/Vienna' }),
      leads
    };
    fs.writeFileSync('data.json', JSON.stringify(outputData, null, 2));
    console.log(`🎉 İŞLEM TAMAM! ${leads.length} veri data.json dosyasına yazıldı.`);

    // 3. AŞAMA: GIT PUSH & BİLDİRİM
    try {
      const gitStatus = execSync('git status --porcelain data.json').toString().trim();
      if (!gitStatus) {
        console.log("ℹ️ 'data.json' değişmedi, Git push atlandı.");
      } else {
        console.log("⏳ GitHub Pages çakışma önleyici (10sn)...");
        await new Promise(r => setTimeout(r, 10000));

        execSync('git add data.json');
        execSync('git commit -m "Auto-update data.json [cron] [skip ci]" || true');
        execSync('git pull origin main --rebase -X ours');
        execSync('git push origin main');
        console.log("✅ GitHub'a başarıyla push edildi!");

        if (leads.length > 0) {
          await sendTelegramMessage(leads[0]);
        }
      }
    } catch (gitErr) {
      console.error("⚠️ Git push hatası:", gitErr.message);
    }

  } catch (error) {
    console.error("💥 Scraper hatası:", error.message);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();
