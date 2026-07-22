const puppeteer = require('puppeteer-core');

(async () => {
  try {
    const browser = await puppeteer.launch({
      headless: "new",
      executablePath: '/usr/bin/google-chrome',
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1920,1080'
      ]
    });
    
    const page = await browser.newPage();
    
    // Webdriver izini gizle (Google bot algılamasını aşmak için)
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    // 1. Çerezleri İşle
    const rawCookies = JSON.parse(process.env.GOOGLE_COOKIES);
    const cleanedCookies = rawCookies.map(cookie => {
      const c = { ...cookie };
      delete c.hostOnly;
      delete c.storeId;
      if (c.sameSite === 'unspecified' || c.sameSite === 'no_restriction') delete c.sameSite;
      if (c.domain && c.domain.startsWith('.')) c.domain = c.domain.substring(1);
      return c;
    });

    // 2. Çerezleri Önce Temiz Bir Google Domain'inde Tanımla
    console.log("Çerezler yükleniyor...");
    await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded' });
    await page.setCookie(...cleanedCookies);

    // 3. Oturum Kontrolü İçin Ads Ana Sayfasına Git
    console.log("Ads oturumu doğrulanıyor...");
    await page.goto('https://ads.google.com/nav/selectaccount', { waitUntil: 'domcontentloaded' });
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 4. Doğrudan Hedef LSA Inbox URL'sine Git
    const targetUrl = 'https://ads.google.com/localservices/inbox?cid=2903573653&bid=10985702078&pid=9999999999&euid=3547106212&hl=de-AT&gl=AT';
    console.log("LSA Inbox sayfasına yönlendiriliyor...");
    
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

    // Sayfa Yüklenme Beklemesi (SPA İçeriğinin Render Edilmesi İçin)
    await new Promise(resolve => setTimeout(resolve, 8000));

    console.log("Mevcut URL:", page.url());
    console.log("Sayfa Başlığı:", await page.title());

    // Oturum Kontrolü
    if (page.url().includes('accounts.google.com')) {
      console.error("HATA: Çerezler Google güvenlik duvarı/IP kısıtlaması nedeniyle reddedildi!");
      await browser.close();
      process.exit(1);
    }

    // 5. Tablo Verilerini Çek
    const leads = await page.evaluate(() => {
      let data = [];
      const rows = document.querySelectorAll('tr, [role="row"]');
      
      rows.forEach(row => {
        const cells = Array.from(row.querySelectorAll('td, [role="gridcell"]'));
        
        if (cells.length >= 5) {
          const firstCell = cells[0]?.innerText?.trim() || '';
          
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
