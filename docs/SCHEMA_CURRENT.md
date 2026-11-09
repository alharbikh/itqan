# هيكل قاعدة بيانات إتقان سمارت برو

**مرجع وصفي للمخطط الحالي؛ ليس نسخة احتياطية أو واجهة SQL مفتوحة.**

- الاستضافة: Supabase PostgreSQL؛ التطبيق: Cloudflare Workers.
- عدد جداول public: **30**.
- حسابات الدخول: Supabase Auth؛ الأدوار: `user_roles` و`school_memberships`.
- المدرسة هي الكيان الأساسي، و`schools.education_department` قيمة نصية اختيارية.
- إجراءات الإدارة الحساسة: دوال RPC تتطلب تسجيل الدخول وتتحقق من الدور وتدوّن الأحداث في `site_admin_audit`.
- حذف المدرسة متاح **فقط عند خلوها من كل السجلات التابعة**؛ خلاف ذلك يجب تعطيلها.
- لم يُنشأ أي حساب أو مدرسة تجريبية عند إنتاج هذا المرجع.

## جداول المخطط

### `public.academic_years`

| العمود | النوع | إلزامي |
|---|---|---|
| `id` | uuid | نعم |
| `label` | text | نعم |
| `starts_on` | date | نعم |
| `ends_on` | date | نعم |
| `is_current` | boolean | نعم |

### `public.criterion_evidence_suggestions`

| العمود | النوع | إلزامي |
|---|---|---|
| `id` | uuid | نعم |
| `criterion_id` | uuid | نعم |
| `title_ar` | text | نعم |
| `description` | text | لا |
| `active` | boolean | نعم |
| `sort_order` | integer | نعم |

### `public.criterion_rating_descriptors`

| العمود | النوع | إلزامي |
|---|---|---|
| `id` | uuid | نعم |
| `framework_id` | uuid | نعم |
| `job_title_id` | uuid | نعم |
| `criterion_id` | uuid | نعم |
| `score_level` | smallint | نعم |
| `descriptor` | text | نعم |

### `public.employee_school_jobs`

| العمود | النوع | إلزامي |
|---|---|---|
| `id` | uuid | نعم |
| `school_employee_id` | uuid | نعم |
| `job_title_id` | uuid | نعم |
| `is_primary` | boolean | نعم |
| `duties` | text | لا |
| `starts_on` | date | لا |
| `ends_on` | date | لا |

### `public.employees`

| العمود | النوع | إلزامي |
|---|---|---|
| `id` | uuid | نعم |
| `user_id` | uuid | لا |
| `full_name` | text | نعم |
| `national_id` | text | لا |
| `nationality` | text | لا |
| `qualification` | text | لا |
| `specialization` | text | لا |
| `mobile` | text | لا |
| `email` | text | لا |
| `government_email` | text | لا |
| `job_number` | text | لا |
| `job_grade` | text | لا |
| `ministry_start_date` | date | لا |
| `created_at` | timestamp with time zone | نعم |
| `updated_at` | timestamp with time zone | نعم |

### `public.evaluation_criteria`

| العمود | النوع | إلزامي |
|---|---|---|
| `id` | uuid | نعم |
| `code` | text | نعم |
| `title_ar` | text | نعم |
| `description` | text | لا |
| `is_common` | boolean | نعم |
| `category` | text | لا |
| `active` | boolean | نعم |
| `created_at` | timestamp with time zone | نعم |
| `updated_at` | timestamp with time zone | نعم |

### `public.evaluation_framework_criteria`

| العمود | النوع | إلزامي |
|---|---|---|
| `framework_id` | uuid | نعم |
| `job_title_id` | uuid | نعم |
| `criterion_id` | uuid | نعم |
| `weight` | numeric | نعم |
| `sort_order` | integer | نعم |
| `is_required` | boolean | نعم |

### `public.evaluation_framework_jobs`

| العمود | النوع | إلزامي |
|---|---|---|
| `framework_id` | uuid | نعم |
| `job_title_id` | uuid | نعم |
| `is_active` | boolean | نعم |

### `public.evaluation_frameworks`

| العمود | النوع | إلزامي |
|---|---|---|
| `id` | uuid | نعم |
| `code` | text | نعم |
| `version_no` | integer | نعم |
| `title_ar` | text | نعم |
| `academic_year` | text | لا |
| `source_reference` | text | لا |
| `effective_from` | date | لا |
| `effective_to` | date | لا |
| `status` | text | نعم |
| `published_at` | timestamp with time zone | لا |
| `created_by` | uuid | لا |
| `created_at` | timestamp with time zone | نعم |

### `public.evaluation_periods`

| العمود | النوع | إلزامي |
|---|---|---|
| `id` | uuid | نعم |
| `school_id` | uuid | نعم |
| `label` | text | نعم |
| `academic_year` | text | نعم |
| `starts_on` | date | نعم |
| `ends_on` | date | نعم |
| `self_evaluation_deadline` | date | لا |
| `manager_review_deadline` | date | لا |
| `status` | text | نعم |
| `created_at` | timestamp with time zone | نعم |
| `academic_year_id` | uuid | لا |

### `public.evaluation_score_details`

| العمود | النوع | إلزامي |
|---|---|---|
| `id` | uuid | نعم |
| `self_evaluation_id` | uuid | لا |
| `performance_review_id` | uuid | لا |
| `framework_id` | uuid | نعم |
| `job_title_id` | uuid | نعم |
| `criterion_id` | uuid | نعم |
| `score_level` | smallint | نعم |
| `weight_snapshot` | numeric | نعم |
| `weighted_score` | numeric | لا |
| `evaluator_notes` | text | لا |
| `created_at` | timestamp with time zone | نعم |

### `public.evidence_assignments`

| العمود | النوع | إلزامي |
|---|---|---|
| `id` | uuid | نعم |
| `school_id` | uuid | نعم |
| `template_id` | uuid | نعم |
| `user_id` | uuid | لا |
| `job_role` | text | لا |
| `is_required` | boolean | نعم |
| `active` | boolean | نعم |
| `assigned_by` | uuid | لا |
| `created_at` | timestamp with time zone | نعم |
| `job_title_id` | uuid | لا |

### `public.evidence_records`

| العمود | النوع | إلزامي |
|---|---|---|
| `id` | uuid | نعم |
| `portfolio_id` | uuid | نعم |
| `school_id` | uuid | نعم |
| `user_id` | uuid | نعم |
| `title` | text | نعم |
| `description` | text | لا |
| `evidence_type` | text | لا |
| `created_at` | timestamp with time zone | نعم |
| `template_id` | uuid | لا |
| `assignment_id` | uuid | لا |
| `evidence_status` | text | نعم |
| `link_url` | text | لا |
| `storage_bucket` | text | لا |
| `storage_path` | text | لا |
| `original_file_name` | text | لا |
| `mime_type` | text | لا |
| `file_size_bytes` | bigint | لا |
| `reviewed_by` | uuid | لا |
| `reviewed_at` | timestamp with time zone | لا |
| `reviewer_notes` | text | لا |

### `public.evidence_templates`

| العمود | النوع | إلزامي |
|---|---|---|
| `id` | uuid | نعم |
| `school_id` | uuid | لا |
| `title` | text | نعم |
| `description` | text | لا |
| `category` | text | لا |
| `criteria_code` | text | لا |
| `is_active` | boolean | نعم |
| `created_by` | uuid | لا |
| `created_at` | timestamp with time zone | نعم |
| `updated_at` | timestamp with time zone | نعم |
| `criterion_id` | uuid | لا |
| `suggestion_id` | uuid | لا |

### `public.job_titles`

| العمود | النوع | إلزامي |
|---|---|---|
| `id` | uuid | نعم |
| `code` | text | نعم |
| `title_ar` | text | نعم |
| `category` | text | نعم |
| `description` | text | لا |
| `is_managerial` | boolean | نعم |
| `active` | boolean | نعم |
| `created_at` | timestamp with time zone | نعم |

### `public.performance_reviews`

| العمود | النوع | إلزامي |
|---|---|---|
| `id` | uuid | نعم |
| `school_id` | uuid | نعم |
| `subject_user_id` | uuid | نعم |
| `reviewer_user_id` | uuid | لا |
| `academic_year` | text | نعم |
| `criteria_scores` | jsonb | نعم |
| `status` | text | نعم |
| `created_at` | timestamp with time zone | نعم |
| `updated_at` | timestamp with time zone | نعم |
| `visible_to_employee` | boolean | نعم |
| `published_at` | timestamp with time zone | لا |
| `notes` | text | لا |
| `self_evaluation_id` | uuid | لا |
| `framework_id` | uuid | لا |
| `job_title_id` | uuid | لا |
| `period_id` | uuid | لا |
| `final_score_100` | numeric | لا |

### `public.permissions`

| العمود | النوع | إلزامي |
|---|---|---|
| `code` | text | نعم |
| `name_ar` | text | نعم |
| `scope` | text | نعم |

### `public.platform_services`

| العمود | النوع | إلزامي |
|---|---|---|
| `code` | text | نعم |
| `name_ar` | text | نعم |
| `description` | text | لا |
| `is_active` | boolean | نعم |

### `public.portfolio_records`

| العمود | النوع | إلزامي |
|---|---|---|
| `id` | uuid | نعم |
| `school_id` | uuid | نعم |
| `user_id` | uuid | نعم |
| `title` | text | نعم |
| `description` | text | لا |
| `category` | text | لا |
| `content` | jsonb | نعم |
| `status` | text | نعم |
| `created_at` | timestamp with time zone | نعم |
| `updated_at` | timestamp with time zone | نعم |

### `public.role_permissions`

| العمود | النوع | إلزامي |
|---|---|---|
| `role_code` | text | نعم |
| `permission_code` | text | نعم |

### `public.roles`

| العمود | النوع | إلزامي |
|---|---|---|
| `code` | text | نعم |
| `name_ar` | text | نعم |
| `scope` | text | نعم |

### `public.school_employees`

| العمود | النوع | إلزامي |
|---|---|---|
| `id` | uuid | نعم |
| `employee_id` | uuid | نعم |
| `school_id` | uuid | نعم |
| `academic_year_id` | uuid | نعم |
| `assignment_date` | date | لا |
| `starts_on` | date | لا |
| `ends_on` | date | لا |
| `weekly_periods` | smallint | لا |
| `educational_supervisor` | text | لا |
| `status` | text | نعم |
| `created_at` | timestamp with time zone | نعم |

### `public.school_memberships`

| العمود | النوع | إلزامي |
|---|---|---|
| `id` | uuid | نعم |
| `school_id` | uuid | نعم |
| `user_id` | uuid | نعم |
| `job_role` | text | نعم |
| `status` | text | نعم |
| `created_at` | timestamp with time zone | نعم |
| `access_role` | text | نعم |
| `job_title_id` | uuid | لا |
| `academic_year_id` | uuid | لا |
| `employee_id` | uuid | لا |

### `public.school_service_access`

| العمود | النوع | إلزامي |
|---|---|---|
| `school_id` | uuid | نعم |
| `service_code` | text | نعم |
| `enabled` | boolean | نعم |
| `enabled_at` | timestamp with time zone | لا |
| `granted_by` | uuid | لا |

### `public.school_staff_assignments`

| العمود | النوع | إلزامي |
|---|---|---|
| `id` | uuid | نعم |
| `school_employee_id` | uuid | نعم |
| `assignment_code` | text | نعم |
| `title_ar` | text | نعم |
| `starts_on` | date | لا |
| `ends_on` | date | لا |
| `responsibilities` | text | لا |
| `is_primary` | boolean | نعم |

### `public.schools`

| العمود | النوع | إلزامي |
|---|---|---|
| `id` | uuid | نعم |
| `name` | text | نعم |
| `education_stage` | text | لا |
| `gender` | text | لا |
| `status` | text | نعم |
| `created_at` | timestamp with time zone | نعم |
| `ministry_number` | text | لا |
| `school_type` | text | لا |
| `study_system` | text | لا |
| `phone` | text | لا |
| `mobile` | text | لا |
| `email` | text | لا |
| `has_special_education` | boolean | نعم |
| `education_department` | text | لا |

### `public.self_evaluations`

| العمود | النوع | إلزامي |
|---|---|---|
| `id` | uuid | نعم |
| `school_id` | uuid | نعم |
| `user_id` | uuid | نعم |
| `academic_year` | text | نعم |
| `criteria_scores` | jsonb | نعم |
| `notes` | text | لا |
| `status` | text | نعم |
| `submitted_at` | timestamp with time zone | لا |
| `created_at` | timestamp with time zone | نعم |
| `updated_at` | timestamp with time zone | نعم |
| `framework_id` | uuid | لا |
| `job_title_id` | uuid | لا |
| `period_id` | uuid | لا |
| `final_score_100` | numeric | لا |

### `public.site_admin_audit`

| العمود | النوع | إلزامي |
|---|---|---|
| `id` | bigint | نعم |
| `actor_user_id` | uuid | نعم |
| `operation` | text | نعم |
| `target_type` | text | نعم |
| `target_id` | uuid | نعم |
| `details` | jsonb | نعم |
| `created_at` | timestamp with time zone | نعم |

### `public.user_roles`

| العمود | النوع | إلزامي |
|---|---|---|
| `user_id` | uuid | نعم |
| `role_code` | text | نعم |

### `public.users`

| العمود | النوع | إلزامي |
|---|---|---|
| `id` | uuid | نعم |
| `full_name` | text | نعم |
| `gender` | text | لا |
| `status` | text | نعم |
| `created_at` | timestamp with time zone | نعم |
| `updated_at` | timestamp with time zone | نعم |

## روابط الإدارة

- [Supabase Table Editor](https://supabase.com/dashboard/project/vyntaycjdspjfkbwnvbh/editor) — يتطلب تسجيل الدخول بصلاحية مالك المشروع.
- [Supabase Authentication](https://supabase.com/dashboard/project/vyntaycjdspjfkbwnvbh/auth/users) — عرض حسابات المصادقة.
- [ترحيلات قاعدة البيانات في GitHub](https://github.com/alharbikh/itqan/tree/main/supabase/migrations) — مصدر المخطط البرمجي.

> لا تستخدم هذا الملف بدل سجل الترحيلات، ولا تنفذ حذفًا مباشرًا من SQL دون نسخة احتياطية وتقييم للتبعيات.
