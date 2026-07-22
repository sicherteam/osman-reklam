const puppeteer = require('puppeteer-core');

(async () => {
  try {
    const browser = await puppeteer.launch({
      headless: "new",
      executablePath: '/usr/bin/google-chrome',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();

    // 1. Çerezleri yükle
    const cookies = JSON.parse(process.env.GOOGLE_COOKIES);
    await page.setCookie(...cookies);

    // 2. LSA Inbox URL'sine git
    const targetUrl = 'https://ads.google.com/localservices/inbox?cid=2903573653&bid=10985702078&pid=9999999999&euid=3547106212&hl=de-AT&gl=AT';
    console.log("LSA Inbox sayfasına gidiliyor...");
    
    await page.goto(targetUrl, { waitUntil: 'networkidle2' });

    // 3. Tablo verilerinin yüklenmesi için 7 saniye bekle
    await new Promise(resolve => setTimeout(resolve, 7000));

    // 4. Tablodaki verileri çek
    const leads = await page.evaluate(() => {
      let data = [];
      
      // HTML Tablosundaki tüm satırları bul (Başlık satırı hariç)
      const rows = document.querySelectorAll('table tbody tr, tr[role="row"], div[role="row"]');
      
      rows.forEach(row => {
        // Satırdaki tüm hücreleri (td / div) al
        const cells = Array.from(row.querySelectorAll('td, div[role="gridcell"]'));
        
        if (cells.length >= 6) {
          const phone = cells[0]?.innerText?.trim() || '';
          const jobType = cells[1]?.innerText?.trim() || '-';
          const location = cells[3]?.innerText?.trim() || '-';
          const type = cells[4]?.innerText?.trim() || '-';
          const status = cells[5]?.innerText?.trim() || '-';
          const date = cells[6]?.innerText?.trim() || '-';

          // Sadece geçerli bir telefon numarası içeren satırları ekle
          if (phone && phone !== 'Kunde') {
            data.push({
              phone,
              jobType,
              location,
              type,
              status,
              date
            });
          }
        }
      });
      
      return data;
    });

    console.log("Çekilen Canlı Veri Sayısı:", leads.length);
    console.log("Çekilen Canlı Veriler:", JSON.stringify(leads, null, 2));

    await browser.close();
  } catch (error) {
    console.error("Scraper çalışırken hata oluştu:", error);
    process.exit(1);
  }
})();
