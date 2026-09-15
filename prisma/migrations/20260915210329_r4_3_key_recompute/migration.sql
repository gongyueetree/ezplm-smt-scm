-- R4-3:键规则统一为「upper + 只保留字母数字(含 CJK)」并重算既有行。
-- 旧规则([^0-9A-Z] 剥离)会把中文厂商名剥成空串;[[:alnum:]] 在 UTF-8 下保留 CJK。
UPDATE "PartMfgMapping" SET
  "manufacturerPartNoKey" = regexp_replace(upper("rawManufacturerPartNo"), '[^[:alnum:]]', '', 'g'),
  "manufacturerKey"       = regexp_replace(upper(coalesce("rawManufacturer", '')), '[^[:alnum:]]', '', 'g');
