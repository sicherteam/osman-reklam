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
      // Puppeteer uyumluluğu için bazı hassas alanları düzelt
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

    // Eğer hala giriş ekranına yönlendiriliyorsa hata verip durdur
    if (pageTitle.includes("Anmelden") || pageTitle.includes("Sign in")) {
      throw new Error("Oturum açılamadı! GOOGLE_COOKIES süresi dolmuş veya geçersiz. Lütfen yeni çerez yükleyin.");
    }

    // 3. İçeriğin tam yüklenmesi için bekle
    await new Promise(resolve => setTimeout(resolve, 8000));

    // 4. Verileri Tara
    const leads = await page.evaluate(() => {
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

          if (phone && phone !== 'Kunde') {
            data.push({ phone, jobType, location, status, date });
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
