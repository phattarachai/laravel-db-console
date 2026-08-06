<?php

declare(strict_types=1);

return [

    'empty' => 'ยังไม่มีคำสั่ง',
    'single_statement' => 'อนุญาตครั้งละ 1 คำสั่ง',
    'must_start' => 'ต้องขึ้นต้นด้วย SELECT',
    'blocked' => 'บล็อก :keyword (เขียนไม่ได้)',
    'read_only' => ':keyword ต้องใช้การเชื่อมต่อที่เขียนได้ อันนี้อ่านได้เท่านั้น',
    'unsupported' => 'ไม่รองรับ :keyword',
    'failed' => 'รันคำสั่งไม่สำเร็จ',

    'hidden_table' => 'ตาราง :table ถูกซ่อนไว้',
    'unknown_table' => 'ไม่พบตาราง :table',
    'unknown_schema' => 'สคีมา :schema ไม่ได้เปิดให้เข้าถึง',

    'read_only_row' => 'การเชื่อมต่อนี้อ่านได้เท่านั้น แก้ข้อมูลไม่ได้',
    'no_primary_key' => 'ตารางนี้ไม่มี primary key จึงแก้ข้อมูลไม่ได้',
    'pk_mismatch' => 'primary key ที่ส่งมาไม่ตรงกับตารางนี้',
    'unknown_column' => 'ไม่พบคอลัมน์ :column',
    'masked_column' => 'คอลัมน์ :column ถูกปิดค่าไว้ เขียนทับไม่ได้',
    'affected_not_one' => 'ต้องกระทบ 1 แถวเท่านั้น แต่ตรงกับ :count แถว จึงยกเลิกการเปลี่ยนแปลง',

    'share_disabled' => 'ปิดการแชร์ลิงก์ไว้',

    'confirm_required' => 'ต้องยืนยันก่อนรันคำสั่งนี้',
    'confirm_invalid' => 'การยืนยันหมดอายุหรือไม่ตรงกับคำสั่งเดิม กรุณายืนยันอีกครั้ง',

];
