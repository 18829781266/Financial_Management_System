export interface PdfRegion {x:number;y:number;width:number;height:number}
export type PdfSplitRequest={id:number;kind:'load';name:string;bytes:ArrayBuffer}|{id:number;kind:'split';sourcePages:number[];region?:PdfRegion}|{id:number;kind:'clear'};
export type PdfSplitResponse={kind:'ready'}|{kind:'loaded';id:number}|{kind:'cleared';id:number}|{kind:'result';id:number;bytes:ArrayBuffer}|{kind:'error';id:number;message:string};
