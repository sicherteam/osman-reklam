const puppeteer = require('puppeteer-core');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// Google Sheets'e Veri Yazma Fonksiyonu
async function appendToGoogleSheet(rows) {
  if (!rows || rows.length === 0) {
    console.log("Google Sheets'e eklenecek yeni veri bulunamadı.");
    return;
  }

  // Google Service Account Kimlik Doğrulaması
  const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

  await doc.loadInfo();
  const sheet = doc.sheetsByIndex[0]; // İlk çalışma sayfasını (Sheet1 / Tablo1) seçer

  console.log(`Google Sheets'e bağlanıldı: "${doc.title}"`);

  // Verileri tabloya ekle
  // Not: Tablonuzun ilk satırında (Header) şu başlıklar bulunmalıdır:
  // Telefon | Hizmet | Konum | Durum | Tarih
  for (const row of rows) {
    await sheet.addRow({
      Telefon: row.phone,
      Hizmet: row.jobType,
      Konum: row.location,
      Durum: row.status,
      Tarih: row.date
    });
  }

  console.log(`${rows.length} adet yeni veri başarıyla Google Sheets'e yazıldı!`);
}

(async () => {
  try {
    const browser = await puppeteer.launch({
      headless: "new",
      executablePath: '/usr/bin/google-chrome',
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled'
      ]
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // 1. Çerezleri Yükle ve Temizle
    if (!process.env.GOOGLE_COOKIES) {
      throw new Error("GOOGLE_COOKIES secret değişkeni bulunamadı!");
    }

    const rawCookies = JSON.parse(process.env.GOOGLE_COOKIES);
    const cookies = rawCookies.map(cookie => {
      const cleaned = { ...cookie };
      if (cleaned.sameSite === 'no_restriction' || cleaned.sameSite === 'unspecified') {
        delete cleaned.sameSite;
      }
      return cleaned;
    });

    await page.setCookie(...cookies);

    // 2. LSA Inbox URL'sine Git
    const targetUrl = 'https://ads.google.com/localservices/inbox?cid=2903573653&bid=10985702078&pid=9999999999&euid=3547106212&hl=de-AT&gl=AT';
    console.log("LSA Inbox sayfasına gidiliyor...");
    
    await page.goto(targetUrl, { waitUntil: 'networkidle2' });

    const pageTitle = await page.title();
    console.log("Sayfa Başlığı:", pageTitle);

    if (pageTitle.includes("Anmelden") || pageTitle.includes("Sign in")) {
      throw new Error("Oturum açılamadı! GOOGLE_COOKIES süresi dolmuş veya geçersiz. Lütfen çerezleri güncelleyin.");
    }

    // 3. İçeriğin Yüklenmesini Bekle
    await new Promise(resolve => setTimeout(resolve, 8000));

    // 4. Verileri Tara ve Yanlış/Gürültü Verileri Filtrele
    const rawLeads = await page.evaluate(() => {
      let data = [];
      const rows = document.querySelectorAll('[role="row"], tr');
      
      rows.forEach(row => {
        const cells = Array.from(row.querySelectorAll('td, div[role="gridcell"]'));
        if (cells.length >= 5) {
          const phone = cells[0]?.innerText?.trim() || '';
          const jobType = cells[1]?.innerText?.trim() || '-';
          const location = cells[3]?.innerText?.trim() || '-';
          const status = cells[5]?.innerText?.trim() || '-';
          const date = cells[6]?.innerText?.trim() || '-';

          // Yalnızca en az 5 rakam barındıran gerçek telefon numaralarını al
          const isRealPhone = /\d{5,}/.test(phone.replace(/\s+/g, ''));

          if (phone && phone !== 'Kunde' && isRealPhone) {
            data.push({ phone, jobType, location, status, date });
          }
        }
      });
      return data;
    });

    // 5. Saate +2 Saat Ekle ve 24 Saatlik Avrupa Formatına Çevir (DD.MM.YY HH:MM)
    const adjustedLeads = rawLeads.map(lead => {
      if (lead.date && lead.date.includes(':')) {
        const match = lead.date.match(/(\d{2})\.(\d{2})\.(\d{2})\s(\d{1,2}):(\d{2})\s?(AM|PM)?/i);
        
        if (match) {
          let [ , day, month, year, hours, minutes, ampm ] = match;
          hours = parseInt(hours, 10);
          
          if (ampm) {
            if (ampm.toUpperCase() === 'PM' && hours < 12) hours += 12;
            if (ampm.toUpperCase() === 'AM' && hours === 12) hours = 0;
          }
          
          const dateObj = new Date(2000 + parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10), hours + 2, parseInt(minutes, 10));
          
          const newDay = String(dateObj.getDate()).padStart(2, '0');
          const newMonth = String(dateObj.getMonth() + 1).padStart(2, '0');
          const newYear = String(dateObj.getFullYear()).slice(-2);
          const newHours = String(dateObj.getHours()).padStart(2, '0');
          const newMins = String(dateObj.getMinutes()).padStart(2, '0');
          
          return {
            ...lead,
            date: `${newDay}.${newMonth}.${newYear} ${newHours}:${newMins}`
          };
        }
      }
      return lead;
    });

    console.log("Çekilen Canlı Veri Sayısı:", adjustedLeads.length);

    // 6. Verileri Google Sheets'e Yazdır
    await appendToGoogleSheet(adjustedLeads);

    await browser.close();
  } catch (error) {
    console.error("Scraper çalışırken hata oluştu:", error.message);
    process.exit(1);
  }
})();
