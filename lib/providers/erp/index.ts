/**
 * ERP Provider 工厂。
 *
 * **业务代码只经这里拿 Provider,不得判断具体厂商。**
 */
import { ExcelErpProvider } from "./excel";
import { KingdeeErpProvider } from "./kingdee";
import { HttpErpLabProvider, resolveErpLabEnv } from "./lab";
import { MockErpProvider } from "./mock";
import { createSkeletonProvider } from "./skeleton";
import type { ErpProvider } from "./types";

const YONYOU_FIELDS = {
  MATERIAL: ["cInvCode", "cInvName", "cInvStd", "cComUnitName", "iMinQty", "iLeadTime"],
  INVENTORY: ["cWhCode", "cInvCode", "cBatch", "iQuantity", "iLockQty"],
  OPEN_PO: ["cPOID", "irowno", "cVenCode", "cInvCode", "iQuantity", "iReceivedQTY", "dArriveDate"],
  WORK_ORDER: ["MoCode", "InvCode", "Qty", "StartDate", "DueDate", "Status"],
};

const SAP_FIELDS = {
  MATERIAL: ["MATNR", "MAKTX", "MEINS", "MINBE", "PLIFZ", "MSTAE"],
  INVENTORY: ["WERKS", "LGORT", "MATNR", "CHARG", "LABST", "INSME"],
  OPEN_PO: ["EBELN", "EBELP", "LIFNR", "MATNR", "MENGE", "WEMNG", "EINDT", "NETPR"],
  WORK_ORDER: ["AUFNR", "MATNR", "STLAL", "GAMNG", "GSTRP", "GLTRP", "STATUS"],
};

const ORACLE_FIELDS = {
  MATERIAL: ["ITEM_NUMBER", "DESCRIPTION", "PRIMARY_UOM", "MIN_ORDER_QTY", "LEAD_TIME"],
  INVENTORY: ["ORGANIZATION_CODE", "SUBINVENTORY", "ITEM_NUMBER", "LOT_NUMBER", "ON_HAND_QTY"],
  OPEN_PO: ["PO_NUMBER", "LINE_NUM", "VENDOR_NAME", "ITEM_NUMBER", "QUANTITY", "QUANTITY_RECEIVED", "PROMISED_DATE"],
  WORK_ORDER: ["WIP_ENTITY_NAME", "ITEM_NUMBER", "BOM_REVISION", "START_QUANTITY", "SCHEDULED_START_DATE"],
};

export function getErpProvider(vendor: string): ErpProvider {
  switch (vendor) {
    case "KINGDEE":
      return new KingdeeErpProvider();
    case "ERP_LAB":
      // 仿真环境:目标地址与令牌只来自服务端环境变量;缺失时 provider 抛 NotConfigured
      return new HttpErpLabProvider(resolveErpLabEnv());
    case "EXCEL":
      return new ExcelErpProvider();
    case "MOCK":
      return new MockErpProvider();
    case "YONYOU":
      return createSkeletonProvider(
        "YONYOU",
        YONYOU_FIELDS,
        "用友 U8/NC/YonBIP 需开通开放平台应用并授权对应档案与单据 API,联调前保持「待联调」",
      );
    case "SAP":
      return createSkeletonProvider(
        "SAP",
        SAP_FIELDS,
        "SAP B1/S4HANA 建议经 OData 或 Service Layer 接入,需客户 IT 开通网关与授权",
      );
    case "ORACLE":
      return createSkeletonProvider(
        "ORACLE",
        ORACLE_FIELDS,
        "Oracle NetSuite/EBS 需开通 REST/SuiteTalk 并配置集成用户",
      );
    default:
      return new MockErpProvider();
  }
}

export * from "./types";
