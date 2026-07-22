const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const LSA_URL = 'https://ads.google.com/local-services-ads/inbox/';

function parseCleanMessage(rawText) {
  if (!rawText || rawText === '-' || !rawText.includes('Unterhaltung')) {
    return rawText;
  }

  let customerHeader = "";

  const headerMatch = rawText.match(
    /(?:Potenzieller Kunde|[A-Z][a-z]+\s+[A-Z][a-z]+)\s+[\d\s]+/i
  );

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

    console.log("🚀 GitHub Actions üzerinde Scraper başlatılıyor...");


    browser = await puppeteer.launch({

      headless: "new",

      executablePath: '/usr/bin/google-chrome',

      // Kalıcı Chrome kullanıcı profili
      userDataDir: './chrome-profile',

      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1920,1080',
        '--lang=de-AT,de'
      ]

    });


    const page = await browser.newPage();


    await page.setViewport({
      width: 1920,
      height: 1080
    });


    await page.setExtraHTTPHeaders({
      'Accept-Language':
      'de-AT,de;q=0.9,en-US;q=0.8,en;q=0.7'
    });


    page.setDefaultNavigationTimeout(90000);
    page.setDefaultTimeout(90000);


    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
    );


    // Cookie yükleme (geçiş aşaması)
    if (
      !process.env.GOOGLE_COOKIES ||
      process.env.GOOGLE_COOKIES.trim() === ''
    ) {
      throw new Error(
        "❌ GOOGLE_COOKIES secret değişkeni bulunamadı!"
      );
    }


    console.log("📌 GOOGLE_COOKIES yükleniyor...");


    const rawCookies =
      JSON.parse(process.env.GOOGLE_COOKIES);


    const cookies = rawCookies.map(cookie => {

      const cleaned = { ...cookie };


      if (
        cleaned.sameSite === 'no_restriction' ||
        cleaned.sameSite === 'unspecified' ||
        !cleaned.sameSite
      ) {
        delete cleaned.sameSite;
      }


      return cleaned;

    });


    await page.setCookie(...cookies);


    console.log(
      `✅ ${cookies.length} adet çerez yüklendi.`
    );
        const targetUrl =
      'https://ads.google.com/localservices/inbox?cid=2903573653&bid=10985702078&pid=9999999999&hl=de-AT&gl=AT';


    console.log("🌐 LSA Inbox sayfasına gidiliyor...");


    await page.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout: 90000
    });


    const pageTitle = await page.title();

    console.log(
      "📄 Sayfa Başlığı:",
      pageTitle
    );


    if (
      pageTitle.includes("Anmelden") ||
      pageTitle.includes("Sign in") ||
      page.url().includes('accounts.google.com')
    ) {

      throw new Error(
        "❌ Oturum açılamadı! GOOGLE_COOKIES süresi dolmuş veya geçersiz."
      );

    }


    console.log(
      "✅ LSA Paneline giriş başarılı."
    );


    // Güncel cookie yedeği
    try {

      const freshCookies =
        await page.cookies();


      fs.writeFileSync(
        'updated_cookies.json',
        JSON.stringify(freshCookies, null, 2)
      );


      console.log(
        "🔄 Güncel cookie kaydedildi."
      );


    } catch(cookieErr) {

      console.warn(
        "⚠️ Cookie kaydedilemedi:",
        cookieErr.message
      );

    }



    console.log(
      "⏳ Sayfa yüklenmesi bekleniyor..."
    );


    await new Promise(resolve =>
      setTimeout(resolve, 6000)
    );



    // Yumuşak scroll
    await page.evaluate(async () => {

      await new Promise(resolve => {

        let totalHeight = 0;

        const distance = 300;


        const timer = setInterval(() => {

          window.scrollBy(
            0,
            distance
          );


          totalHeight += distance;


          if(totalHeight >= 1200){

            clearInterval(timer);

            resolve();

          }


        },200);


      });

    });



    await new Promise(resolve =>
      setTimeout(resolve,2000)
    );



    // Gerçek lead satırlarını bul
    const validRowsIndices = await page.evaluate(() => {


      const allRows =
        Array.from(
          document.querySelectorAll(
            '[role="row"], tr'
          )
        );


      const valid = [];



      allRows.forEach((row, idx) => {


        const text =
          row.innerText || '';



        const cells =
          Array.from(
            row.querySelectorAll(
              'td, div[role="gridcell"]'
            )
          );



        if(cells.length >= 4){


          const firstCol =
            cells[0]?.innerText?.trim() || '';



          if(
            firstCol &&
            firstCol !== 'Kunde' &&
            !firstCol.includes('Telefon') &&
            firstCol.length > 2
          ){


            const isMessage =
              /nachricht|message/i.test(text);



            const jobType =
              cells[1]?.innerText?.trim() || '-';



            const location =
              cells[3]?.innerText?.trim() || '-';



            let rawStatus =
              cells[5]?.innerText?.trim() ||
              cells[4]?.innerText?.trim() ||
              '-';



            const status =
              rawStatus.split('\n')[0].trim();



            const date =
              cells[6]?.innerText?.trim() ||
              cells[5]?.innerText?.trim() ||
              '-';



            valid.push({

              domIndex: idx,

              phone: firstCol,

              jobType,

              location,

              status,

              date,

              isMessage

            });


          }

        }


      });



      return valid;


    });



    console.log(
      `📊 Gerçek Lead Sayısı: ${validRowsIndices.length}`
    );



    let leads = [];
        // Lead detaylarını aç ve mesajları çek
    for (const item of validRowsIndices) {

      let messageText = "-";


      if (item.isMessage) {

        try {

          console.log(
            `[${item.phone}] Mesaj paneli açılıyor...`
          );


          const clickSuccess =
            await page.evaluate((index) => {


              const rows =
                Array.from(
                  document.querySelectorAll(
                    '[role="row"], tr'
                  )
                );


              const targetRow =
                rows[index];


              if (!targetRow) return false;



              const clickTarget =
                targetRow.querySelector(
                  'td, div[role="gridcell"]'
                ) || targetRow;



              ['mousedown','mouseup','click']
                .forEach(eventType => {


                  const evt =
                    new MouseEvent(
                      eventType,
                      {
                        bubbles:true,
                        cancelable:true,
                        view:window
                      }
                    );


                  clickTarget.dispatchEvent(evt);


                });



              return true;


            }, item.domIndex);



          if(clickSuccess){


            await new Promise(resolve =>
              setTimeout(resolve,4500)
            );



            let rawMessageText =
              await page.evaluate(() => {


                const elements =
                  Array.from(
                    document.querySelectorAll(
                      'div, section, article'
                    )
                  );



                const chatBlock =
                  elements.find(el => {


                    const txt =
                      el.innerText || '';



                    return (
                      txt.includes('Unterhaltung') &&
                      txt.length > 20
                    );


                  });



                if(chatBlock)
                  return chatBlock.innerText.trim();



                const sideDrawer =
                  document.querySelector(
                    '[role="region"], .conversation-view, .detail-view, drawer-content'
                  );



                if(
                  sideDrawer &&
                  sideDrawer.innerText.length > 10
                ){
                  return sideDrawer.innerText.trim();
                }



                return "-";


              });



            messageText =
              parseCleanMessage(rawMessageText);



            console.log(
              ` -> [${item.phone}] ${messageText.substring(0,60)}...`
            );


          }


        } catch(err){

          console.warn(
            `[${item.phone}] Hata:`,
            err.message
          );

        }

      }



      leads.push({

        phone:item.phone,

        jobType:item.jobType,

        location:item.location,

        status:item.status,

        date:item.date,

        messageText


      });


    }



    // Datum formatieren
    const adjustedLeads =
      leads.map(lead => {


        if(
          lead.date &&
          lead.date.includes(':')
        ){


          const match =
            lead.date.match(
              /(\d{2})\.(\d{2})\.(\d{2})\s(\d{1,2}):(\d{2})\s?(AM|PM)?/i
            );



          if(match){


            let [
              ,
              day,
              month,
              year,
              hours,
              minutes,
              ampm
            ] = match;



            hours =
              parseInt(hours,10);



            if(ampm){

              if(
                ampm.toUpperCase()==='PM' &&
                hours < 12
              ){
                hours += 12;
              }


              if(
                ampm.toUpperCase()==='AM' &&
                hours === 12
              ){
                hours = 0;
              }

            }



            const dateObj =
              new Date(
                2000 + parseInt(year,10),
                parseInt(month,10)-1,
                parseInt(day,10),
                hours+2,
                parseInt(minutes,10)
              );



            return {

              ...lead,

              date:
              `${String(dateObj.getDate()).padStart(2,'0')}.${String(dateObj.getMonth()+1).padStart(2,'0')}.${String(dateObj.getFullYear()).slice(-2)} ${String(dateObj.getHours()).padStart(2,'0')}:${String(dateObj.getMinutes()).padStart(2,'0')}`

            };


          }

        }


        return lead;


      });



    const outputData = {

      updatedAt:
        new Date().toLocaleString(
          'de-AT',
          {
            timeZone:'Europe/Vienna'
          }
        ),

      leads: adjustedLeads

    };



    fs.writeFileSync(
      'data.json',
      JSON.stringify(
        outputData,
        null,
        2
      )
    );



    console.log(
      `🎉 İŞLEM TAMAM! ${adjustedLeads.length} veri data.json yazıldı.`
    );



  } catch(error){


    console.error(
      "💥 Scraper hatası:",
      error.message
    );



    if(browser)
      await browser.close();



    process.exit(1);


  }



  if(browser)
    await browser.close();



})();
