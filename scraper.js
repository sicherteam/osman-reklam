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

    // 1. ZAMAN DİLİMİNİ AVUSTURYA / VİYANA YAP (Saat kaymasını önler)
    await page.emulateTimezone('Europe/Vienna');
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // 2. Çerezleri Yükle
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

    // 3. LSA Inbox URL'sine Git
    const targetUrl = 'https://ads.google.com/localservices/inbox?cid=2903573653&bid=10985702078&pid=9999999999&euid=3547106212&hl=de-AT&gl=AT';
    console.log("LSA Inbox sayfasına gidiliyor...");
    
    await page.goto(targetUrl, { waitUntil: 'networkidle2' });

    // Yüklenme Beklemesi
    await new Promise(resolve => setTimeout(resolve, 7000));

    // 4. Temiz Verileri Çek
    const leads = await page.evaluate(() => {
      let data = [];
      const rows = document.querySelectorAll('table tbody tr, tr[role="row"], div[role="row"]');
      
      // Avusturya Telefon Numarası Formatı Kontrolü (Örn: 0676, 0664, 0699, 076, 0681 vb.)
      const phoneRegex = /^(06\d{2}|07\d{2}|068\d)\s?[\d\s]+$/;

      rows.forEach(row => {
        const cells = Array.from(row.querySelectorAll('td, div[role="gridcell"]'));
        
        if (cells.length >= 6) {
          const rawPhone = cells[0]?.innerText?.trim() || '';
          
          // SADECE gerçek telefon numarası olan satırları filtrele
          if (phoneRegex.test(rawPhone)) {
            const jobType = cells[1]?.innerText?.trim() || '-';
            const location = cells[3]?.innerText?.trim() || '-';
            
            // "Wird überprüft\nhelp_outline" gibi icon yazılarını temizle
            let status = cells[5]?.innerText?.trim() || '-';
            status = status.replace(/\n?help_outline/g, '').trim();

            // Tarih ve saat hücresini bul
            let date = '-';
            for (let i = 6; i < cells.length; i++) {
              const cellText = cells[i]?.innerText?.trim() || '';
              if (/\d{2}\.\d{2}\.\d{2}/.test(cellText)) {
                date = cellText.replace(/\n/g, ' '); // Alt satıra geçen saatleri tek satıra al
                break;
              }
            }

            data.push({
              phone: rawPhone,
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
