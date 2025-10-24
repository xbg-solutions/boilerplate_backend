/**
 * ERP Connector
 * Enterprise Resource Planning - HR and Finance operations
 */

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
} from './types';
import { logger } from '../logger';

/**
 * ERP Provider Interface
 */
export interface ERPProvider {
  // Employee operations
  getEmployee(employeeId: string): Promise<Employee>;
  getEmployees(options?: ERPQueryOptions): Promise<ERPResponse<Employee>>;
  createEmployee(employee: Omit<Employee, 'id'>): Promise<Employee>;
  updateEmployee(employeeId: string, updates: Partial<Employee>): Promise<Employee>;

  // Time off operations
  requestTimeOff(request: TimeOffRequest): Promise<ERPResponse<TimeOffRequest>>;
  getTimeOffBalance(employeeId: string): Promise<TimeOffBalance[]>;
  getTimeOffRequests(employeeId: string, options?: ERPQueryOptions): Promise<ERPResponse<TimeOffRequest>>;

  // Payroll operations
  getPayStubs(employeeId: string, options?: ERPQueryOptions): Promise<ERPResponse<PayStub>>;

  // Expense operations
  createExpenseReport(expense: ExpenseReport): Promise<ExpenseReport>;
  getExpenseReports(employeeId: string, options?: ERPQueryOptions): Promise<ERPResponse<ExpenseReport>>;

  // Department operations
  getDepartment(departmentId: string): Promise<Department>;
  getDepartments(options?: ERPQueryOptions): Promise<ERPResponse<Department>>;

  // Recruiting operations
  getJobRequisitions(options?: ERPQueryOptions): Promise<ERPResponse<JobRequisition>>;
}

/**
 * ERP Connector
 * Unified interface for ERP systems
 */
export class ERPConnector {
  private provider: ERPProvider;

  constructor(provider: ERPProvider) {
    this.provider = provider;
  }

  /**
   * Get employee by ID
   */
  async getEmployee(employeeId: string): Promise<Employee> {
    logger.info('Fetching employee', { employeeId });

    try {
      return await this.provider.getEmployee(employeeId);
    } catch (error) {
      logger.error('Error fetching employee', {
        employeeId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get multiple employees with filtering
   */
  async getEmployees(options?: ERPQueryOptions): Promise<ERPResponse<Employee>> {
    logger.info('Fetching employees', { options });

    try {
      return await this.provider.getEmployees(options);
    } catch (error) {
      logger.error('Error fetching employees', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create new employee
   */
  async createEmployee(employee: Omit<Employee, 'id'>): Promise<Employee> {
    logger.info('Creating employee', {
      email: employee.email,
      name: `${employee.firstName} ${employee.lastName}`,
    });

    try {
      return await this.provider.createEmployee(employee);
    } catch (error) {
      logger.error('Error creating employee', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update employee data
   */
  async updateEmployee(employeeId: string, updates: Partial<Employee>): Promise<Employee> {
    logger.info('Updating employee', { employeeId, updates });

    try {
      return await this.provider.updateEmployee(employeeId, updates);
    } catch (error) {
      logger.error('Error updating employee', {
        employeeId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Request time off
   */
  async requestTimeOff(request: TimeOffRequest): Promise<ERPResponse<TimeOffRequest>> {
    logger.info('Requesting time off', {
      employeeId: request.employeeId,
      type: request.type,
      startDate: request.startDate,
      endDate: request.endDate,
    });

    try {
      return await this.provider.requestTimeOff(request);
    } catch (error) {
      logger.error('Error requesting time off', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get time off balance
   */
  async getTimeOffBalance(employeeId: string): Promise<TimeOffBalance[]> {
    logger.info('Fetching time off balance', { employeeId });

    try {
      return await this.provider.getTimeOffBalance(employeeId);
    } catch (error) {
      logger.error('Error fetching time off balance', {
        employeeId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get time off requests
   */
  async getTimeOffRequests(employeeId: string, options?: ERPQueryOptions): Promise<ERPResponse<TimeOffRequest>> {
    logger.info('Fetching time off requests', { employeeId, options });

    try {
      return await this.provider.getTimeOffRequests(employeeId, options);
    } catch (error) {
      logger.error('Error fetching time off requests', {
        employeeId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get pay stubs
   */
  async getPayStubs(employeeId: string, options?: ERPQueryOptions): Promise<ERPResponse<PayStub>> {
    logger.info('Fetching pay stubs', { employeeId, options });

    try {
      return await this.provider.getPayStubs(employeeId, options);
    } catch (error) {
      logger.error('Error fetching pay stubs', {
        employeeId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create expense report
   */
  async createExpenseReport(expense: ExpenseReport): Promise<ExpenseReport> {
    logger.info('Creating expense report', {
      employeeId: expense.employeeId,
      amount: expense.amount,
      category: expense.category,
    });

    try {
      return await this.provider.createExpenseReport(expense);
    } catch (error) {
      logger.error('Error creating expense report', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get expense reports
   */
  async getExpenseReports(employeeId: string, options?: ERPQueryOptions): Promise<ERPResponse<ExpenseReport>> {
    logger.info('Fetching expense reports', { employeeId, options });

    try {
      return await this.provider.getExpenseReports(employeeId, options);
    } catch (error) {
      logger.error('Error fetching expense reports', {
        employeeId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get department by ID
   */
  async getDepartment(departmentId: string): Promise<Department> {
    logger.info('Fetching department', { departmentId });

    try {
      return await this.provider.getDepartment(departmentId);
    } catch (error) {
      logger.error('Error fetching department', {
        departmentId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get departments
   */
  async getDepartments(options?: ERPQueryOptions): Promise<ERPResponse<Department>> {
    logger.info('Fetching departments', { options });

    try {
      return await this.provider.getDepartments(options);
    } catch (error) {
      logger.error('Error fetching departments', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get job requisitions
   */
  async getJobRequisitions(options?: ERPQueryOptions): Promise<ERPResponse<JobRequisition>> {
    logger.info('Fetching job requisitions', { options });

    try {
      return await this.provider.getJobRequisitions(options);
    } catch (error) {
      logger.error('Error fetching job requisitions', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
