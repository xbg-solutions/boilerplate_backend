/**
 * Workday Provider for ERP Connector
 * https://community.workday.com/sites/default/files/file-hosting/restapi/index.html
 */

import axios, { AxiosInstance } from 'axios';
import { ERPProvider } from '../erp-connector';
import {
  Employee,
  TimeOffRequest,
  TimeOffBalance,
  PayStub,
  ExpenseReport,
  Department,
  JobRequisition,
  ERPQueryOptions,
  ERPResponse,
} from '../types';

export interface WorkdayProviderConfig {
  tenantName: string;
  username: string;
  password: string;
  baseUrl?: string; // Optional custom base URL
}

export class WorkdayProvider implements ERPProvider {
  private client: AxiosInstance;
  private tenantName: string;

  constructor(config: WorkdayProviderConfig) {
    this.tenantName = config.tenantName;

    const baseURL = config.baseUrl || `https://wd2-impl-services1.workday.com/ccx/service/${config.tenantName}`;

    this.client = axios.create({
      baseURL,
      auth: {
        username: config.username,
        password: config.password,
      },
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Get employee by ID
   */
  async getEmployee(employeeId: string): Promise<Employee> {
    try {
      const response = await this.client.get(`/Human_Resources/v1/workers/${employeeId}`);
      return this.mapWorkdayWorkerToEmployee(response.data);
    } catch (error: any) {
      throw new Error(`Failed to get employee: ${error.message}`);
    }
  }

  /**
   * Get employees with filtering
   */
  async getEmployees(options?: ERPQueryOptions): Promise<ERPResponse<Employee>> {
    try {
      const params: any = {
        limit: options?.limit || 50,
        offset: options?.page ? (options.page - 1) * (options.limit || 50) : 0,
      };

      const response = await this.client.get('/Human_Resources/v1/workers', { params });

      const employees = response.data?.data?.map((worker: any) =>
        this.mapWorkdayWorkerToEmployee(worker)
      ) || [];

      return {
        success: true,
        data: employees,
        total: response.data?.total,
        page: options?.page,
        limit: options?.limit,
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'WORKDAY_ERROR',
          message: error.message,
          details: error.response?.data,
        },
      };
    }
  }

  /**
   * Create employee
   */
  async createEmployee(employee: Omit<Employee, 'id'>): Promise<Employee> {
    try {
      const payload = {
        firstName: employee.firstName,
        lastName: employee.lastName,
        email: employee.email,
        jobProfile: employee.jobTitle,
        location: employee.workLocation,
        hireDate: employee.hireDate,
      };

      const response = await this.client.post('/Human_Resources/v1/workers', payload);
      return this.mapWorkdayWorkerToEmployee(response.data);
    } catch (error: any) {
      throw new Error(`Failed to create employee: ${error.message}`);
    }
  }

  /**
   * Update employee
   */
  async updateEmployee(employeeId: string, updates: Partial<Employee>): Promise<Employee> {
    try {
      const payload: any = {};

      if (updates.email) payload.email = updates.email;
      if (updates.jobTitle) payload.jobProfile = updates.jobTitle;
      if (updates.department) payload.organization = updates.department;
      if (updates.workLocation) payload.location = updates.workLocation;

      const response = await this.client.patch(`/Human_Resources/v1/workers/${employeeId}`, payload);
      return this.mapWorkdayWorkerToEmployee(response.data);
    } catch (error: any) {
      throw new Error(`Failed to update employee: ${error.message}`);
    }
  }

  /**
   * Request time off
   */
  async requestTimeOff(request: TimeOffRequest): Promise<ERPResponse<TimeOffRequest>> {
    try {
      const payload = {
        worker: { id: request.employeeId },
        timeOffType: request.type,
        from: request.startDate,
        to: request.endDate,
        comment: request.reason,
      };

      await this.client.post('/Absence_Management/v1/timeOffEntries', payload);

      return {
        success: true,
        data: [{ ...request, status: 'pending' }],
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'WORKDAY_ERROR',
          message: error.message,
          details: error.response?.data,
        },
      };
    }
  }

  /**
   * Get time off balance
   */
  async getTimeOffBalance(employeeId: string): Promise<TimeOffBalance[]> {
    try {
      const response = await this.client.get(`/Absence_Management/v1/workers/${employeeId}/timeOffBalances`);

      return response.data?.data?.map((balance: any) => ({
        employeeId,
        type: balance.timeOffType?.descriptor || 'unknown',
        balance: balance.balance || 0,
        unit: balance.unit === 'Days' ? 'days' : 'hours',
        accrualRate: balance.accrualRate,
      })) || [];
    } catch (error: any) {
      throw new Error(`Failed to get time off balance: ${error.message}`);
    }
  }

  /**
   * Get time off requests
   */
  async getTimeOffRequests(employeeId: string, options?: ERPQueryOptions): Promise<ERPResponse<TimeOffRequest>> {
    try {
      const response = await this.client.get(`/Absence_Management/v1/workers/${employeeId}/timeOffEntries`);

      const requests = response.data?.data?.map((entry: any) => ({
        employeeId,
        type: entry.timeOffType?.descriptor?.toLowerCase() || 'other',
        startDate: new Date(entry.from),
        endDate: new Date(entry.to),
        hours: entry.hours,
        reason: entry.comment,
        status: this.mapWorkdayStatus(entry.status),
      })) || [];

      return {
        success: true,
        data: requests,
        total: requests.length,
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'WORKDAY_ERROR',
          message: error.message,
        },
      };
    }
  }

  /**
   * Get pay stubs
   */
  async getPayStubs(employeeId: string, options?: ERPQueryOptions): Promise<ERPResponse<PayStub>> {
    try {
      const response = await this.client.get(`/Payroll/v1/workers/${employeeId}/payStatements`);

      const payStubs = response.data?.data?.map((statement: any) => ({
        id: statement.id,
        employeeId,
        payPeriodStart: new Date(statement.periodStart),
        payPeriodEnd: new Date(statement.periodEnd),
        payDate: new Date(statement.payDate),
        grossPay: statement.grossPay,
        netPay: statement.netPay,
        deductions: statement.deductions?.map((d: any) => ({
          type: d.type,
          amount: d.amount,
          description: d.description,
        })) || [],
        currency: statement.currency || 'USD',
      })) || [];

      return {
        success: true,
        data: payStubs,
        total: payStubs.length,
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'WORKDAY_ERROR',
          message: error.message,
        },
      };
    }
  }

  /**
   * Create expense report
   */
  async createExpenseReport(expense: ExpenseReport): Promise<ExpenseReport> {
    try {
      const payload = {
        worker: { id: expense.employeeId },
        date: expense.date,
        description: expense.description,
        amount: expense.amount,
        currency: expense.currency,
        category: expense.category,
      };

      const response = await this.client.post('/Expense/v1/expenseReports', payload);

      return {
        id: response.data.id,
        ...expense,
        status: 'submitted',
      };
    } catch (error: any) {
      throw new Error(`Failed to create expense report: ${error.message}`);
    }
  }

  /**
   * Get expense reports
   */
  async getExpenseReports(employeeId: string, options?: ERPQueryOptions): Promise<ERPResponse<ExpenseReport>> {
    try {
      const response = await this.client.get(`/Expense/v1/workers/${employeeId}/expenseReports`);

      const reports = response.data?.data?.map((report: any) => ({
        id: report.id,
        employeeId,
        date: new Date(report.date),
        description: report.description,
        amount: report.amount,
        currency: report.currency || 'USD',
        category: report.category,
        status: this.mapWorkdayExpenseStatus(report.status),
      })) || [];

      return {
        success: true,
        data: reports,
        total: reports.length,
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'WORKDAY_ERROR',
          message: error.message,
        },
      };
    }
  }

  /**
   * Get department
   */
  async getDepartment(departmentId: string): Promise<Department> {
    try {
      const response = await this.client.get(`/Human_Resources/v1/organizations/${departmentId}`);
      const org = response.data;

      return {
        id: org.id,
        name: org.name,
        code: org.code,
        manager: org.manager ? {
          id: org.manager.id,
          name: org.manager.descriptor,
        } : undefined,
        employeeCount: org.headcount,
      };
    } catch (error: any) {
      throw new Error(`Failed to get department: ${error.message}`);
    }
  }

  /**
   * Get departments
   */
  async getDepartments(options?: ERPQueryOptions): Promise<ERPResponse<Department>> {
    try {
      const response = await this.client.get('/Human_Resources/v1/organizations');

      const departments = response.data?.data?.map((org: any) => ({
        id: org.id,
        name: org.name,
        code: org.code,
        manager: org.manager ? {
          id: org.manager.id,
          name: org.manager.descriptor,
        } : undefined,
        employeeCount: org.headcount,
      })) || [];

      return {
        success: true,
        data: departments,
        total: departments.length,
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'WORKDAY_ERROR',
          message: error.message,
        },
      };
    }
  }

  /**
   * Get job requisitions
   */
  async getJobRequisitions(options?: ERPQueryOptions): Promise<ERPResponse<JobRequisition>> {
    try {
      const response = await this.client.get('/Recruiting/v1/jobRequisitions');

      const requisitions = response.data?.data?.map((req: any) => ({
        id: req.id,
        title: req.title,
        department: req.organization?.descriptor || '',
        status: this.mapWorkdayRequisitionStatus(req.status),
        openDate: req.openDate ? new Date(req.openDate) : undefined,
        closeDate: req.closeDate ? new Date(req.closeDate) : undefined,
        hiringManager: req.hiringManager ? {
          id: req.hiringManager.id,
          name: req.hiringManager.descriptor,
        } : undefined,
        description: req.description,
      })) || [];

      return {
        success: true,
        data: requisitions,
        total: requisitions.length,
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'WORKDAY_ERROR',
          message: error.message,
        },
      };
    }
  }

  /**
   * Map Workday worker to Employee
   */
  private mapWorkdayWorkerToEmployee(worker: any): Employee {
    return {
      id: worker.id,
      employeeId: worker.employeeID,
      email: worker.primaryWorkEmail,
      firstName: worker.legalFirstName || worker.preferredFirstName,
      lastName: worker.legalLastName || worker.preferredLastName,
      displayName: worker.preferredName,
      jobTitle: worker.businessTitle,
      department: worker.primarySupervisoryOrganization?.descriptor,
      manager: worker.manager ? {
        id: worker.manager.id,
        name: worker.manager.descriptor,
      } : undefined,
      hireDate: worker.hireDate ? new Date(worker.hireDate) : undefined,
      status: worker.activeStatusCode === 'Active' ? 'active' : 'inactive',
      workLocation: worker.primaryWorkLocation?.descriptor,
      workPhone: worker.primaryWorkPhone,
    };
  }

  /**
   * Map Workday status to standard status
   */
  private mapWorkdayStatus(status: string): 'pending' | 'approved' | 'denied' {
    const statusMap: Record<string, any> = {
      'In Progress': 'pending',
      'Approved': 'approved',
      'Denied': 'denied',
      'Rejected': 'denied',
    };
    return statusMap[status] || 'pending';
  }

  /**
   * Map Workday expense status
   */
  private mapWorkdayExpenseStatus(status: string): 'draft' | 'submitted' | 'approved' | 'rejected' | 'paid' {
    const statusMap: Record<string, any> = {
      'Draft': 'draft',
      'In Progress': 'submitted',
      'Approved': 'approved',
      'Rejected': 'rejected',
      'Paid': 'paid',
    };
    return statusMap[status] || 'draft';
  }

  /**
   * Map Workday requisition status
   */
  private mapWorkdayRequisitionStatus(status: string): 'draft' | 'open' | 'closed' | 'filled' {
    const statusMap: Record<string, any> = {
      'Draft': 'draft',
      'Open': 'open',
      'Closed': 'closed',
      'Filled': 'filled',
    };
    return statusMap[status] || 'draft';
  }
}
