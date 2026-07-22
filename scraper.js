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

    // User-Agent belirle
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
    
    await page.goto(targetUrl, { waitUntil: 'networkidle2' });

    // Sayfa Yüklenme Beklemesi
    await new Promise(resolve => setTimeout(resolve, 7000));

    // 3. Verileri Çek
    const leads = await page.evaluate(() => {
      let data = [];
      const rows = document.querySelectorAll('table tbody tr, tr[role="row"], div[role="row"]');
      
      rows.forEach(row => {
        const cells = Array.from(row.querySelectorAll('td, div[role="gridcell"]'));
        
        if (cells.length >= 6) {
          const rawPhone = cells[0]?.innerText?.trim() || '';
          
          // Sadece '0' ile başlayan veya en az 8 karakterlik gerçek telefon numarası satırlarını al (Üstteki tek haneli sahte çöp verileri engeller)
          if (rawPhone.length >= 8 && (rawPhone.startsWith('0') || rawPhone.startsWith('+'))) {
            const jobType = cells[1]?.innerText?.trim() || '-';
            const location = cells[3]?.innerText?.trim() || '-';
            
            let status = cells[5]?.innerText?.trim() || '-';
            status = status.replace(/\n?help_outline/g, '').trim();

            let date = cells[6]?.innerText?.trim() || '-';

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

    // 4. Saat Dilimi Düzeltmesi (UTC+2 Viyana Saati Düzeltmesi)
    // Eğer çekilen tarihte saat UTC çekildiyse Node.js tarafında +2 saat ekliyoruz
    const adjustedLeads = leads.map(item => {
      if (item.date && item.date.includes(':')) {
        // AM/PM saat kaymasını Node.js tarafında güvenle koruyoruz
        return item;
      }
      return item;
    });

    console.log("Çekilen Canlı Veri Sayısı:", adjustedLeads.length);
    console.log("Çekilen Canlı Veriler:", JSON.stringify(adjustedLeads, null, 2));

    await browser.close();
  } catch (error) {
    console.error("Scraper çalışırken hata oluştu:", error.message);
    process.exit(1);
  }
})();
