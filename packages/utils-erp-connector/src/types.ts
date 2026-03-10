/**
 * ERP Connector Types
 * Enterprise Resource Planning - HR and Finance operations
 */

/**
 * Employee data
 */
export interface Employee {
  id: string;
  employeeId?: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName?: string;
  jobTitle?: string;
  department?: string;
  manager?: {
    id: string;
    name: string;
  };
  hireDate?: Date;
  terminationDate?: Date;
  status: 'active' | 'inactive' | 'terminated';
  workLocation?: string;
  workPhone?: string;
  customFields?: Record<string, any>;
}

/**
 * Time off request
 */
export interface TimeOffRequest {
  employeeId: string;
  type: 'vacation' | 'sick' | 'personal' | 'other';
  startDate: Date;
  endDate: Date;
  hours?: number;
  reason?: string;
  status?: 'pending' | 'approved' | 'denied';
}

/**
 * Time off balance
 */
export interface TimeOffBalance {
  employeeId: string;
  type: string;
  balance: number;
  unit: 'hours' | 'days';
  accrualRate?: number;
}

/**
 * Pay stub information
 */
export interface PayStub {
  id: string;
  employeeId: string;
  payPeriodStart: Date;
  payPeriodEnd: Date;
  payDate: Date;
  grossPay: number;
  netPay: number;
  deductions: Array<{
    type: string;
    amount: number;
    description?: string;
  }>;
  currency: string;
}

/**
 * Expense report
 */
export interface ExpenseReport {
  id?: string;
  employeeId: string;
  date: Date;
  description: string;
  amount: number;
  currency: string;
  category: string;
  status?: 'draft' | 'submitted' | 'approved' | 'rejected' | 'paid';
  receipts?: Array<{
    url: string;
    filename: string;
  }>;
}

/**
 * Department/Cost center
 */
export interface Department {
  id: string;
  name: string;
  code?: string;
  manager?: {
    id: string;
    name: string;
  };
  parentDepartment?: {
    id: string;
    name: string;
  };
  employeeCount?: number;
}

/**
 * Job requisition/posting
 */
export interface JobRequisition {
  id: string;
  title: string;
  department: string;
  status: 'draft' | 'open' | 'closed' | 'filled';
  openDate?: Date;
  closeDate?: Date;
  hiringManager?: {
    id: string;
    name: string;
  };
  description?: string;
  requirements?: string[];
}

/**
 * ERP query options
 */
export interface ERPQueryOptions {
  page?: number;
  limit?: number;
  filters?: Record<string, any>;
  sort?: {
    field: string;
    order: 'asc' | 'desc';
  };
}

/**
 * ERP response with pagination
 */
export interface ERPResponse<T> {
  success: boolean;
  data?: T[];
  total?: number;
  page?: number;
  limit?: number;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}
