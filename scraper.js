const puppeteer = require('puppeteer-core');

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

    // Standard User-Agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // 1. Çerezleri Yükle
    const rawCookies = JSON.parse(process.env.GOOGLE_COOKIES);
    const cleanedCookies = rawCookies.map(cookie => {
      const c = { ...cookie };
      delete c.hostOnly;
      delete c.storeId;
      if (c.sameSite === 'unspecified' || c.sameSite === 'no_restriction') delete c.sameSite;
      if (c.domain && c.domain.startsWith('.')) c.domain = c.domain.substring(1);
      return c;
    });

    await page.setCookie(...cleanedCookies);

    // 2. LSA Inbox URL'sine Git
    const targetUrl = 'https://ads.google.com/localservices/inbox?cid=2903573653&bid=10985702078&pid=9999999999&euid=3547106212&hl=de-AT&gl=AT';
    console.log("LSA Inbox sayfasına gidiliyor...");
    
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

    // 3. Tablo Yüklenene Kadar Bekle (Max 15 saniye)
    console.log("Tablonun DOM'a yüklenmesi bekleniyor...");
    try {
      await page.waitForSelector('table, [role="row"], div[role="gridcell"]', { timeout: 15000 });
    } catch (e) {
      console.log("Uyarı: Belirtilen tablo seçicisi zaman aşımına uğradı, sabit bekleme yapılıyor...");
    }

    // Ekranın tam oturması için ilave 5 saniye bekleme
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 4. Verileri Çek
    const leads = await page.evaluate(() => {
      let data = [];
      
      // Sayfadaki tüm satır benzeri yapıları topla
      const rows = document.querySelectorAll('tr, [role="row"]');
      
      rows.forEach(row => {
        const cells = Array.from(row.querySelectorAll('td, [role="gridcell"]'));
        
        if (cells.length >= 5) {
          const firstCell = cells[0]?.innerText?.trim() || '';
          
          // İlk hücre boş değilse ve "Kunde" (başlık) değilse al
          if (firstCell && !firstCell.toLowerCase().includes('kunde')) {
            const jobType = cells[1]?.innerText?.trim() || '-';
            const location = cells[3]?.innerText?.trim() || '-';
            
            let status = cells[5]?.innerText?.trim() || '-';
            status = status.replace(/\n?help_outline/g, '').trim();

            let date = cells[6]?.innerText?.trim() || cells[5]?.innerText?.trim() || '-';

            data.push({
              phone: firstCell,
              jobType,
              location,
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
    console.error("Scraper çalışırken hata oluştu:", error.message);
    process.exit(1);
  }
})();
