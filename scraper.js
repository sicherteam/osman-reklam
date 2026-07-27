require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

puppeteer.use(StealthPlugin());

// --- TELEGRAM BİLDİRİM AYARLARI (.env dosyasından okunur) ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PROJECT_NAME = 'Osman Reklam'; // Proje ayrımı için

// Tarihi 24 Saatlik Formata Çeviren Gelişmiş Fonksiyon (AM/PM Tam Dönüşüm)
function parseTo24HourDate(dateStr) {
  if (!dateStr || dateStr === '-') return '-';

  // Boşluk ve bitişik AM/PM durumlarını düzenleme
  let fixedStr = dateStr.replace(/(\b\d{1,2})(\d{2})\s*(AM|PM)/gi, '$1:$2 $3');

  // "27.07.26 7:24 PM" veya "27.07.26 07:24PM" gibi tüm varyasyonları yakalar
  const regex = /(\d{2}\.\d{2}\.\d{2})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i;
  const match = fixedStr.match(regex);

  if (match) {
    let [, datePart, hoursStr, minutes, modifier] = match;
    let hours = parseInt(hoursStr, 10);

    if (modifier) {
      const isPM = modifier.toUpperCase() === 'PM';
      const isAM = modifier.toUpperCase() === 'AM';

      if (isPM && hours < 12) hours += 12;
      if (isAM && hours === 12) hours = 0;
    }

    const formattedHours = String(hours).padStart(2, '0');
    return `${datePart} ${formattedHours}:${minutes}`;
  }

  return dateStr;
}

// Telegram Bildirim Fonksiyonu (24 Saatlik Tarih Garantili)
function sendTelegramMessage(lead) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn("⚠️ Telegram bilgileri eksik! Lütfen .env dosyasını kontrol et.");
    return;
  }

  // Tarihlerin 24 saatlik formatta gönderilmesini garanti ediyoruz
  const ilkGorusme24 = parseTo24HourDate(lead["Ilk gorusme"]);
  const sonGorusme24 = parseTo24HourDate(lead["Son gorusme"]);

  const message = `🔔 *YENİ MÜSTERI!* (${PROJECT_NAME})\n\n` +
                  `👤 *Müşteri:* ${lead["Musteri"]}\n` +
                  `📍 *Konum:* ${lead["Konum"]}\n` +
                  `💼 *Hizmet:* ${lead["Hizmet"]}\n` +
                  `📅 *İlk Görüşme:* ${ilkGorusme24}\n` +
                  `⏳ *Son Görüşme:* ${sonGorusme24}\n` +
                  `💬 *Mesaj:* ${lead["Mesaj"]}`;

  const data = JSON.stringify({
    chat_id: TELEGRAM_CHAT_ID,
    text: message,
    parse_mode: 'Markdown'
  });

  const options = {
    hostname: 'api.telegram.org',
    port: 443,
    path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  };

  const req = https.request(options, (res) => {
    let responseString = '';
    res.on('data', chunk => { responseString += chunk; });
    res.on('end', () => {
      console.log('📱 Telegram bildirimi başarıyla gönderildi.');
    });
  });

  req.on('error', (error) => {
    console.error('⚠️ Telegram mesajı atılamadı:', error.message);
  });

  req.write(data);
  req.end();
}

// Ham panel metninden MÜŞTERİ BİLGİSİ ve SADECE GERÇEK MESAJI süzen fonksiyon
function parseCleanMessage(rawText) {
  if (!rawText || rawText === '-' || !rawText.includes('Unterhaltung')) {
    return rawText;
  }

  let customerHeader = "";
  const headerMatch = rawText.match(/(?:Potenzieller Kunde|[A-Z][a-z]+\s+[A-Z][a-z]+)\s+[\d\s]+/i);
  if (headerMatch) {
    customerHeader = headerMatch[0].trim();
  }

  let parts = rawText.split('Unterhaltung');
  let chatContent = parts[parts.length - 1];

  chatContent = chatContent
    .split('Wird geladen')[0]
    .split('Audioinhalte')[0]
    .split('Hier dem Kunden')[0]
    .trim();

  chatContent = chatContent
    .replace(/^P\s+/gi, '')
    .replace(/^Potenzieller Kunde\s+/gi, '')
    .replace(/^\d{2}\.\d{2}\.\d{2}\s+/gi, '')
    .trim();

  if (customerHeader && chatContent) {
    return `[${customerHeader}]\n${chatContent}`;
  }

  return chatContent.length > 0 ? chatContent : rawText;
}

(async () => {
  let browser;
  try {
    const userDataPath = '/home/ubuntu/osman-reklam/user_data';

    // 0. ÇAKIŞMA VE KİLİT DOSYALARINI TEMİZLE
    try {
      const singletonLock = path.join(userDataPath, 'SingletonLock');
      const singletonCookie = path.join(userDataPath, 'SingletonCookie');
      const singletonSocket = path.join(userDataPath, 'SingletonSocket');
      
      if (fs.existsSync(singletonLock)) fs.unlinkSync(singletonLock);
      if (fs.existsSync(singletonCookie)) fs.unlinkSync(singletonCookie);
      if (fs.existsSync(singletonSocket)) fs.unlinkSync(singletonSocket);
    } catch (cleanErr) {
      console.warn("⚠️ Kilit dosyaları temizlenirken ufak uyarı:", cleanErr.message);
    }

    // 1. TARAYICIYI BAŞLAT
    browser = await puppeteer.launch({
      headless: "new",
      executablePath: '/usr/bin/google-chrome',
      userDataDir: userDataPath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1920,1080',
        '--lang=de-AT,de'
      ]
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'de-AT,de;q=0.9,en-US;q=0.8,en;q=0.7'
    });

    page.setDefaultNavigationTimeout(90000);
    page.setDefaultTimeout(90000);

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const targetUrl = 'https://ads.google.com/localservices/inbox?cid=2903573653&bid=10985702078&pid=9999999999&euid=3547106212&hl=de-AT&gl=AT';
    console.log("LSA Inbox sayfasına gidiliyor...");
    
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 90000 });

    const pageTitle = await page.title();
    console.log("Sayfa Başlığı:", pageTitle);

    if (
      pageTitle.includes("Anmelden") || 
      pageTitle.includes("Sign in") || 
      pageTitle.includes("YouTube") || 
      pageTitle.includes("Error") || 
      pageTitle.includes("504") || 
      pageTitle.includes("Serverfehler")
    ) {
      throw new Error(`❌ Oturum açılamadı veya Google engelledi! Başlık: ${pageTitle}`);
    }

    console.log("Sayfa içeriğinin yüklenmesi ve yumuşak scroll bekleniyor...");
    await new Promise(resolve => setTimeout(resolve, 6000));

    // Alt satırların tam yüklenmesi için yumuşak scroll
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        let distance = 300;
        let timer = setInterval(() => {
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= 1200) {
            clearInterval(timer);
            resolve();
          }
        }, 200);
      });
    });
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 2. AŞAMA: GERÇEK SATIRLARI VE İÇERİKLERİNİ AKILLI TESPİT ET (Sıkı Konum Filtresi)
    const validRowsIndices = await page.evaluate(() => {
      const allRows = Array.from(document.querySelectorAll('[role="row"], tr'));
      const valid = [];

      allRows.forEach((row, idx) => {
        const text = row.innerText || '';
        const rawCells = Array.from(row.querySelectorAll('td, div[role="gridcell"]'));
        
        const cleanCellTexts = rawCells
          .map(c => c.innerText ? c.innerText.trim() : '')
          .filter(txt => txt.length > 0 && !/^\d{1,3}$/.test(txt));

        if (cleanCellTexts.length >= 3) {
          const isHeader = text.includes('Gebührenstatus') || text.includes('Kunde') || text.includes('Kundenname');
          
          if (!isHeader) {
            const isMessage = /nachricht|message/i.test(text);

            let customerName = cleanCellTexts[0] || '-';
            if (/^\d{1,3}$/.test(customerName)) {
              customerName = cleanCellTexts[1] || '-';
            }

            let jobType = cleanCellTexts[1] || '-';

            // --- AKILLI KONUM TESPİTİ (Numara, Kategorie, Statüleri Eler) ---
            let location = '-';
            const locCell = cleanCellTexts.find(t => 
              t !== customerName && 
              !t.includes(customerName) && 
              !/^\+?\d[\d\s-]{6,}$/.test(t) && // Telefon numarası kalıplarını eler
              !/^(Kategorie|Direkte|Telefon|Nachricht|Belastet|Wird)/i.test(t) && // Sütun başlığı ve statüleri eler
              !/\d{2}\.\d{2}\.\d{2}/.test(t) // Tarihleri eler
            );

            if (locCell) {
              location = locCell;
            }

            const dateCells = cleanCellTexts.filter(t => /\d{2}\.\d{2}\.\d{2}/.test(t));
            let anfrageDate = '-';
            let letzteDate = '-';

            if (dateCells.length >= 2) {
              anfrageDate = dateCells[0];
              letzteDate = dateCells[1];
            } else if (dateCells.length === 1) {
              anfrageDate = dateCells[0];
              letzteDate = dateCells[0];
            }

            if (customerName === '-' || (location === '-' && jobType === '-')) {
              return;
            }

            valid.push({
              domIndex: idx,
              phone: customerName,
              jobType: jobType,
              location: location,
              anfrageDate: anfrageDate,
              letzteDate: letzteDate,
              isMessage: isMessage
            });
          }
        }
      });

      return valid;
    });

    console.log(`📊 Gerçek Lead Sayısı: ${validRowsIndices.length}`);

    if (validRowsIndices.length === 0) {
      throw new Error("❌ Sayfada hiçbir mesaj bulunamadı! Sayfa tam yüklenmemiş veya Google engellemiş olabilir. Eski verileri korumak için işlem iptal ediliyor.");
    }

    let leads = [];

    // 3. AŞAMA: SATIRLARA TIKLA VE TEMİZ MESAJLARI AL
    for (const item of validRowsIndices) {
      let messageText = "-";

      if (item.isMessage) {
        try {
          console.log(`[${item.phone}] Mesaj paneli açılıyor...`);

          const clickSuccess = await page.evaluate((index) => {
            const rows = Array.from(document.querySelectorAll('[role="row"], tr'));
            const targetRow = rows[index];
            if (!targetRow) return false;

            const clickTarget = targetRow.querySelector('td, div[role="gridcell"]') || targetRow;
            
            ['mousedown', 'mouseup', 'click'].forEach(eventType => {
              const evt = new MouseEvent(eventType, {
                bubbles: true,
                cancelable: true,
                view: window
              });
              clickTarget.dispatchEvent(evt);
            });
            return true;
          }, item.domIndex);

          if (clickSuccess) {
            await new Promise(resolve => setTimeout(resolve, 4500));

            let rawMessageText = await page.evaluate(() => {
              const conversationElements = Array.from(document.querySelectorAll('div, section, article'));
              const chatBlock = conversationElements.find(el => {
                const txt = el.innerText || '';
                return txt.includes('Unterhaltung') && txt.length > 20;
              });

              if (chatBlock) return chatBlock.innerText.trim();

              const sideDrawer = document.querySelector('[role="region"], .conversation-view, .detail-view, drawer-content');
              if (sideDrawer && sideDrawer.innerText.length > 10) {
                return sideDrawer.innerText.trim();
              }

              return "-";
            });

            messageText = parseCleanMessage(rawMessageText);
            console.log(` -> [${item.phone}] ÇEKİLEN MESAJ:`, messageText.replace(/\n/g, ' ').substring(0, 60) + "...");
          }

        } catch (err) {
          console.warn(` -> [${item.phone}] Hata:`, err.message);
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

    const outputData = {
      updatedAt: new Date().toLocaleString('de-AT', { timeZone: 'Europe/Vienna' }),
      leads: leads
    };

    fs.writeFileSync('data.json', JSON.stringify(outputData, null, 2));
    console.log(`🎉 İŞLEM TAMAM! Toplam ${leads.length} veri temiz bir şekilde data.json dosyasına yazıldı.`);

    // --- AKILLI VE GÜVENLİ GIT PUSH / BİLDİRİM ADIMI ---
    try {
      const gitStatus = execSync('git status --porcelain data.json').toString().trim();

      if (!gitStatus) {
        console.log("ℹ️ 'data.json' içeriğinde yeni bir değişiklik yok. Git push pas geçildi.");
      } else {
        // GitHub Pages'in eşzamanlı yayın çakışmasını önlemek için 10s bekleme
        console.log("⏳ GitHub Pages çakışmasını önlemek için 10 saniye bekleniyor...");
        await new Promise(resolve => setTimeout(resolve, 10000));

        console.log("🚀 'data.json' güncellendi! GitHub'a push ediliyor...");
        
        execSync('git add data.json');
        execSync('git commit -m "Auto-update data.json [cron] [skip ci]" || true');
        execSync('git pull origin main --rebase -X ours');
        execSync('git push origin main');
        
        console.log("✅ GitHub'a başarıyla push edildi!");

        if (leads.length > 0) {
          sendTelegramMessage(leads[0]);
        }
      }
    } catch (gitErr) {
      console.error("⚠️ Git push hatası:", gitErr.message);
    }

    if (browser) await browser.close();
  } catch (error) {
    console.error("💥 Scraper hatası:", error.message);
    if (browser) await browser.close();
    process.exit(1);
  }
})();
