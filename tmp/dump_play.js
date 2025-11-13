const puppeteer=require('puppeteer');
(async()=>{
  const browser=await puppeteer.launch({headless:'new'});
  const page=await browser.newPage();
  await page.emulate({viewport:{width:412,height:915,isMobile:true,deviceScaleFactor:2},userAgent:'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'});
  await page.goto('https://www.tiktok.com/@mixuprecipes7/video/7567937233425091862',{waitUntil:'networkidle2',timeout:60000});
  await new Promise(r=>setTimeout(r,3000));
  const tree=await page.evaluate(()=>{
    const el=document.querySelector('[class*="DivPlayBtnPos"]');
    if(!el)return null;
    function serialize(node,depth=0){
      if(!node||depth>4)return null;
      return {
        tag:node.tagName,
        class:node.className,
        attrs:node.getAttributeNames?Object.fromEntries(node.getAttributeNames().map(n=>[n,node.getAttribute(n)])):{},
        child:serialize(node.firstElementChild,depth+1)
      };
    }
    return serialize(el);
  });
  console.log(JSON.stringify(tree,null,2));
  await browser.close();
})();
