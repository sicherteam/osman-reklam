const puppeteer = require('puppeteer-core');

(async () => {
  try {
    const browser = await puppeteer.launch({
      headless: "new",
      executablePath: '/usr/bin/google-chrome',
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled' // Bot tespitini engellemek için
      ]
    });
    
    const page = await browser.newPage();

    // User-Agent belirleyerek bot olarak algılanmayı önle
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // 1. Çerezleri Ayarla ve Temizle
    const rawCookies = JSON.parse(process.env.GOOGLE_COOKIES);
    const cookies = rawCookies.map(cookie => {
      const cleaned = { ...cookie };
      if (cleaned.sameSite === 'no_restriction' || cleaned.sameSite === 'unspecified') {
        delete cleaned.sameSite;
      }
      return cleaned;
    });

    await page.setCookie(...cookies);

    // 2. LSA Inbox URL'sine git
    const targetUrl = 'https://ads.google.com/localservices/inbox?cid=2903573653&bid=10985702078&pid=9999999999&euid=3547106212&hl=de-AT&gl=AT';
    console.log("LSA Inbox sayfasına gidiliyor...");
    
    await page.goto(targetUrl, { waitUntil: 'networkidle2' });

    // Sayfa başlığını kontrol et
    const pageTitle = await page.title();
    console.log("Sayfa Başlığı:", pageTitle);
    console.log("Mevcut URL:", page.url());

    // Eğer oturum kapalıysa hata ver
    if (pageTitle.includes("Anmelden") || pageTitle.includes("Sign in")) {
      throw new Error("Oturum açılamadı! GOOGLE_COOKIES süresi dolmuş veya geçersiz. Lütfen yeni çerez yükleyin.");
    }

    // 3. İçeriğin tam yüklenmesi için bekle
    await new Promise(resolve => setTimeout(resolve, 8000));

    // 4. Verileri Tara ve Yanlış Verileri Filtrele
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

          // FİLTRELEME: Yalnızca en az 5 rakam barındıran gerçek telefonları al
          const isRealPhone = /\d{5,}/.test(phone.replace(/\s+/g, ''));

          if (phone && phone !== 'Kunde' && isRealPhone) {
            data.push({ phone, jobType, location, status, date });
          }
        }
      });
      return data;
    });

    // 5. Saate +2 Saat Ekleme ve 24 Saatlik (Avrupa) Formatına Çevirme
    const adjustedLeads = rawLeads.map(lead => {
      if (lead.date && lead.date.includes(':')) {
        // Örnek giriş formatı: "21.07.26 11:11 AM" veya "21.07.26 11:11 PM"
        const match = lead.date.match(/(\d{2})\.(\d{2})\.(\d{2})\s(\d{1,2}):(\d{2})\s?(AM|PM)?/i);
        
        if (match) {
          let [ , day, month, year, hours, minutes, ampm ] = match;
          hours = parseInt(hours, 10);
          
          if (ampm) {
            // AM/PM varsa 24 saatlik düzene çevir
            if (ampm.toUpperCase() === 'PM' && hours < 12) hours += 12;
            if (ampm.toUpperCase() === 'AM' && hours === 12) hours = 0;
          }
          
          // Saate +2 ekle (gün/ay taşmalarını Date nesnesi otomatik halleder)
          const dateObj = new Date(2000 + parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10), hours + 2, parseInt(minutes, 10));
          
          // Avrupa formatına (DD.MM.YY HH:MM) dönüştür
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
    console.log("Çekilen Canlı Veriler:", JSON.stringify(adjustedLeads, null, 2));

    await browser.close();
  } catch (error) {
    console.error("Scraper çalışırken hata oluştu:", error.message);
    process.exit(1);
  }
})();
