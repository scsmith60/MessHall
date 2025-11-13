const puppeteer=require('puppeteer');
(async()=>{
  const browser=await puppeteer.launch({headless:'new'});
  const page=await browser.newPage();
  await page.emulate({viewport:{width:412,height:915,isMobile:true,deviceScaleFactor:2},userAgent:'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'});
  await page.goto('https://www.tiktok.com/@mixuprecipes7/video/7567937233425091862',{waitUntil:'networkidle2',timeout:60000});
  await new Promise(r=>setTimeout(r,3000));
  await page.evaluate(()=>{
    const el=document.querySelector('[class*="DivPlayBtnPos"]');
    if(el){el.remove();}
  });
  await new Promise(r=>setTimeout(r,1000));
  const still=await page.evaluate(()=>!!document.querySelector('[class*="DivPlayBtnPos"]'));
  console.log('still there?',still);
  await browser.close();
})();
