-- Clinical fixture schema for smoke testing

CREATE TABLE patients (
  patient_id   INTEGER PRIMARY KEY,
  name         VARCHAR(200) NOT NULL,
  dob          DATE,
  status       VARCHAR(20) DEFAULT 'Active'  -- Active | Discharged | Deceased
);

CREATE TABLE conditions (
  condition_id INTEGER PRIMARY KEY,
  patient_id   INTEGER NOT NULL REFERENCES patients(patient_id),
  code         VARCHAR(20),
  description  TEXT,
  onset_date   DATE
);

CREATE TABLE claims (
  claim_id     INTEGER PRIMARY KEY,
  condition_id INTEGER NOT NULL REFERENCES conditions(condition_id),
  amount       DECIMAL(10,2),
  filed_date   DATE
);
