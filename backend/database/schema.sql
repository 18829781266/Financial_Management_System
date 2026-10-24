-- MySQL 8.0 / utf8mb4。先由管理员创建数据库与最小权限应用账号，再执行本文件。
CREATE DATABASE IF NOT EXISTS langchao_archive CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE langchao_archive;
CREATE TABLE voucher (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, source_system VARCHAR(32) NOT NULL, external_id VARCHAR(128) NOT NULL,
 voucher_no VARCHAR(64) NOT NULL, voucher_sequence INT NOT NULL, period CHAR(7) NOT NULL, summary VARCHAR(1000),
 amount DECIMAL(19,2) NOT NULL CHECK(amount>0), supplier_name VARCHAR(255), normalized_supplier_name VARCHAR(255),
 voucher_date DATE NOT NULL, invoice_no VARCHAR(128), contract_no VARCHAR(128), bank_flow_no VARCHAR(128), approval_no VARCHAR(128),
 custom_fields JSON, image_url VARCHAR(512), expected_attachment_count INT NOT NULL CHECK(expected_attachment_count>0),
 status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','MATCHED','MISSING','LOCKED')),
 missing_reason VARCHAR(1000), created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uk_erp(source_system,external_id), UNIQUE KEY uk_period_no(period,voucher_no), KEY idx_period_seq(period,voucher_sequence),
 KEY idx_invoice(invoice_no), KEY idx_contract(contract_no), FULLTEXT KEY ft_voucher(summary,supplier_name) WITH PARSER ngram
) ENGINE=InnoDB;
CREATE TABLE voucher_entry (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, voucher_id BIGINT NOT NULL, line_no INT NOT NULL, account_code VARCHAR(64) NOT NULL,
 account_name VARCHAR(255) NOT NULL, direction VARCHAR(6) NOT NULL CHECK(direction IN ('DEBIT','CREDIT')), amount DECIMAL(19,2) NOT NULL CHECK(amount>=0),
 UNIQUE KEY uk_line(voucher_id,line_no), CONSTRAINT fk_entry_voucher FOREIGN KEY(voucher_id) REFERENCES voucher(id)
) ENGINE=InnoDB;
CREATE TABLE source_document (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, period CHAR(7) NOT NULL, doc_type VARCHAR(24) NOT NULL, file_name VARCHAR(255) NOT NULL,
 image_url VARCHAR(512) NOT NULL, content_hash CHAR(64) NOT NULL, invoice_no VARCHAR(128), contract_no VARCHAR(128), bank_flow_no VARCHAR(128), approval_no VARCHAR(128),
 supplier_name VARCHAR(255), normalized_supplier_name VARCHAR(255), amount DECIMAL(19,2) NOT NULL CHECK(amount>0), document_date DATE NOT NULL,
 seal_present BOOLEAN, extracted_fields JSON, ocr_confidence DECIMAL(6,5),
 status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','MATCHED','LOCKED')), created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uk_file(period,content_hash), KEY idx_pending(period,status), KEY idx_invoice(invoice_no), KEY idx_contract(contract_no),
 FULLTEXT KEY ft_document(supplier_name) WITH PARSER ngram
) ENGINE=InnoDB;
CREATE TABLE match_rule (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, rule_id VARCHAR(8) NOT NULL UNIQUE, rule_name VARCHAR(128) NOT NULL, priority INT NOT NULL,
 match_type VARCHAR(24) NOT NULL, threshold DECIMAL(6,5) NOT NULL CHECK(threshold>=0 AND threshold<=1), conditions JSON NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT TRUE, version INT NOT NULL DEFAULT 0
) ENGINE=InnoDB;
CREATE TABLE match_relation (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, relation_id CHAR(36) NOT NULL, voucher_id BIGINT NOT NULL, doc_id BIGINT NOT NULL,
 allocated_amount DECIMAL(19,2) NOT NULL CHECK(allocated_amount>0), match_type VARCHAR(24) NOT NULL, rule_id VARCHAR(8),
 confidence_score DECIMAL(6,5) NOT NULL CHECK(confidence_score>=0 AND confidence_score<=1), creator VARCHAR(128) NOT NULL,
 reason VARCHAR(1000), explanation JSON, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uk_allocation(voucher_id,doc_id), KEY idx_relation_group(relation_id), KEY idx_doc(doc_id),
 CONSTRAINT fk_relation_voucher FOREIGN KEY(voucher_id) REFERENCES voucher(id), CONSTRAINT fk_relation_doc FOREIGN KEY(doc_id) REFERENCES source_document(id)
) ENGINE=InnoDB;
CREATE TABLE archive_book (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, period CHAR(7) NOT NULL, start_voucher_no VARCHAR(64) NOT NULL, end_voucher_no VARCHAR(64) NOT NULL,
 start_voucher_sequence INT NOT NULL, end_voucher_sequence INT NOT NULL, pdf_url VARCHAR(512) NOT NULL,
 hash_code CHAR(64) NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'LOCKED' CHECK(status='LOCKED'),
 voucher_count INT NOT NULL, document_count INT NOT NULL, creator VARCHAR(128) NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uk_range(period,start_voucher_no,end_voucher_no), KEY idx_period(period)
) ENGINE=InnoDB;
CREATE TABLE sys_log (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, action VARCHAR(64) NOT NULL, target_type VARCHAR(64) NOT NULL, target_id VARCHAR(128) NOT NULL,
 detail TEXT NOT NULL, operator VARCHAR(128) NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, KEY idx_target(target_type,target_id)
) ENGINE=InnoDB;
INSERT INTO match_rule(rule_id,rule_name,priority,match_type,threshold,conditions) VALUES
 ('R01','发票号精确匹配',10,'EXACT',0.95,'{"absTolerance":0.05,"relativeTolerance":0}'),
 ('R02','合同号精确匹配',20,'EXACT',0.95,'{"absTolerance":0.05,"relativeTolerance":0}'),
 ('R03','银行流水号精确匹配',30,'EXACT',0.95,'{"absTolerance":0.05,"relativeTolerance":0}'),
 ('R04','审批单号精确匹配',40,'EXACT',0.95,'{"absTolerance":0.05,"relativeTolerance":0}'),
 ('R05','金额客商日期精确匹配',50,'COMPOSITE',0.90,'{"absTolerance":0.05,"relativeTolerance":0,"nameThreshold":1,"dateWindowDays":7}'),
 ('R06','金额客商日期模糊匹配',60,'FUZZY',0.85,'{"absTolerance":0.05,"relativeTolerance":0,"nameThreshold":0.85,"dateWindowDays":7}'),
 ('R07','多单据汇总匹配',70,'AGGREGATE',0.90,'{"absTolerance":0.05,"relativeTolerance":0,"nameThreshold":0.85,"dateWindowDays":7,"maxCandidates":18,"maxNodes":100000}');
-- 应用服务在同一事务中按 voucher.id、source_document.id 升序 SELECT ... FOR UPDATE，
-- 检查状态和金额后写关系并更新状态。Redis锁只负责降低争用，数据库行锁和唯一键负责最终一致性。
