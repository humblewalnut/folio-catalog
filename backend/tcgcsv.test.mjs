import test from 'node:test';import assert from 'node:assert/strict';
import {validateTCGCSVMaps,tcgcsvEntry} from './tcgcsv.mjs';
const now=Date.parse('2026-10-14T00:00:00Z'),stamp='2026-10-13T20:00:00Z';
const m={identity:{cardID:'test',language:'English',finish:'Normal',edition:'1st Edition'},categoryID:3,groupID:1,groupName:'Test',productID:2,productName:'Card',number:'1/100',printing:'1st Edition',reviewedAt:stamp,evidenceURL:'https://www.tcgplayer.com/product/2/card'};
const products={success:true,results:[{productId:2,categoryId:3,groupId:1,name:'Card',url:m.evidenceURL,extendedData:[{name:'Number',value:'1/100'}]}]};
const prices={success:true,results:[{productId:2,subTypeName:'1st Edition',marketPrice:10},{productId:2,subTypeName:'Unlimited',marketPrice:1}]};
test('exact raw printing uses market value and the source build date, not fetch time',()=>{validateTCGCSVMaps([m],now);const result=tcgcsvEntry(m,products,prices,stamp,now);assert.equal(result.references[0].amount,'10');assert.equal(result.references[0].observedAt,stamp.replace('Z','.000Z'));assert.match(result.references[0].meaning,/condition not specified/);});
test('wrong category, product number, duplicate printing and expired snapshot are rejected',()=>{
 for(const patch of [{categoryId:85},{groupId:2},{name:'Other'},{extendedData:[{name:'Number',value:'2/100'}]}])assert.equal(tcgcsvEntry(m,{...products,results:[{...products.results[0],...patch}]},prices,stamp,now).status,'ambiguous');
 assert.equal(tcgcsvEntry(m,products,{...prices,results:[...prices.results,prices.results[0]]},stamp,now).status,'ambiguous');
 assert.equal(tcgcsvEntry(m,products,{...prices,results:[prices.results[1]]},stamp,now).status,'unavailable');
 assert.throws(()=>tcgcsvEntry(m,products,prices,stamp,now+8*86400000));
 assert.throws(()=>validateTCGCSVMaps([{...m,categoryID:85}],now));
});
