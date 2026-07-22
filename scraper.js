const puppeteer = require('puppeteer');

(async () => {
  try {
    const browser = await puppeteer.launch({
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();

    // 1. GitHub Secrets içinden çerezleri yükle
    const cookies = JSON.parse(process.env.GOOGLE_COOKIES);
    await page.setCookie(...cookies);

    // 2. Doğrudan Hesabın LSA Inbox URL'sine Git
    const targetUrl = 'https://ads.google.com/localservices/inbox?cid=2903573653&bid=10985702078&pid=9999999999&euid=3547106212&hl=de-AT&gl=AT';
    console.log("LSA Inbox sayfasına gidiliyor...");
    
    await page.goto(targetUrl, { waitUntil: 'networkidle2' });

    // 3. Tablo / Liste yüklenene kadar bekle (Verilerin geldiğinden emin olmak için)
    // Google LSA ekranında DOM elemanlarının yüklenmesini bekliyoruz
    await page.waitForTimeout(5000); // Ekranın tam oturması için kısa bir bekleme

    // 4. Canlı Verileri Çek
    const leads = await page.evaluate(() => {
      let data = [];
      
      // LSA gelen kutusundaki her bir satırı tara
      // Not: Google HTML sınıflarını güncelleyebilir, DOM seçicilerini paneline göre kontrol edebilirsin
      const rows = document.querySelectorAll('[role="row"], .lead-row-class, .customer-row');
      
      rows.forEach(row => {
        const name = row.querySelector('.customer-name, [data-field="name"]')?.innerText || 'İsimsiz';
        const phone = row.querySelector('.phone-number, [data-field="phone"], a[href^="tel:"]')?.innerText || 'Numara Yok';
        const date = row.querySelector('.call-date, .time-stamp, [data-field="date"]')?.innerText || 'Tarih Yok';
        
        if (phone !== 'Numara Yok' || name !== 'İsimsiz') {
          data.push({ name, phone, date });
        }
      });
      
      return data;
    });

    console.log("Çekilen Canlı Veriler:", leads);

    // TODO: Bir sonraki adımda bu 'leads' verisini Google Sheets'e yazdıracağız.

    await browser.close();
  } catch (error) {
    console.error("Scraper çalışırken hata oluştu:", error);
    process.exit(1);
  }
})();
